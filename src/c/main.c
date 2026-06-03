#include <pebble.h>
#include <stdlib.h>
#include <string.h>

#define INBOX_SIZE 2048
#define OUTBOX_SIZE_MIN 512
#define STATUS_HEIGHT 28
#define STATUS_TEXT_MAX 128
#define TRANSCRIPT_MAX 512
#define REPLY_LINE_HEIGHT 28
#define SCROLL_STEP_PX 48
#define HIST_MAX_ITEMS 20
#define HIST_LABEL_CHARS 32
#define HIST_LABELS_BUF 512
#define HIST_BROWSE_TEXT_MAX 640

#define VIBE_SUCCESS_SEGMENTS 5
#define VIBE_ERROR_SEGMENTS 3
#define VIBE_PROMPT_SEGMENTS 1
#define UP_DOUBLE_CLICK_MIN 2
#define UP_DOUBLE_CLICK_MAX 2
#define UP_DOUBLE_CLICK_TIMEOUT_MS 400

typedef enum {
  APP_MODE_CHAT = 0,
  APP_MODE_HISTORY_WAIT,
  APP_MODE_HISTORY_BROWSE
} AppMode;

static Window *s_window;
static TextLayer *s_status_layer;
static ScrollLayer *s_scroll_layer;
static TextLayer *s_reply_layer;
static ActionBarLayer *s_action_bar;
static Layer *s_sidebar_layer;
static GBitmap *s_icon_up;
static GBitmap *s_icon_down;
static GBitmap *s_icon_mic;
static GBitmap *s_icon_history;
static GBitmap *s_icon_read;
static GBitmap *s_icon_back;
#define SIDEBAR_ROWS 4

static char s_status_text[STATUS_TEXT_MAX];

static char *s_reply_accum = NULL;
static size_t s_reply_accum_len = 0;
static char *s_reply_display = NULL;
static uint32_t s_expected_reply_parts = 0;
static uint32_t s_expected_reply_bytes = 0;
static uint32_t s_received_reply_parts = 0;
static bool s_vibrate_enabled = true;
static bool s_hist_viewing = false;

static AppMode s_app_mode = APP_MODE_CHAT;
static uint16_t s_hist_expected_count = 0;
static uint16_t s_hist_count = 0;
static uint16_t s_hist_browse_index = 0;
static char s_hist_labels[HIST_MAX_ITEMS][HIST_LABEL_CHARS];
static char s_hist_browse_text[HIST_BROWSE_TEXT_MAX];

static const uint32_t s_vibe_success_pattern[] = { 80, 80, 120, 80, 200 };
static const uint32_t s_vibe_error_pattern[] = { 200, 120, 280 };
static const uint32_t s_vibe_prompt_pattern[] = { 60 };

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
static char s_transcript[TRANSCRIPT_MAX];
#endif

static void hist_request_open(void);
static void hist_send_get(uint8_t index);
static void hist_labels_reset(void);
static void hist_labels_parse(const char *src);
static void hist_labels_fill_missing(void);
static void hist_browse_enter(void);
static void hist_browse_render(void);
static void hist_browse_exit(void);
static void reply_display_refresh(void);
static void action_bar_refresh_icons(void);
static void sidebar_layer_update(Layer *layer, GContext *ctx);
static void sidebar_destroy_icons(void);
static void sidebar_load_icons(void);
static void sidebar_draw_icon(GContext *ctx, GRect bounds, int row, const GBitmap *icon);

static void vibe_play(const uint32_t *pattern, uint32_t segments) {
  VibePattern vibe;

  if (!s_vibrate_enabled || pattern == NULL || segments == 0) {
    return;
  }

  vibes_cancel();
  vibe.durations = pattern;
  vibe.num_segments = segments;
  vibes_enqueue_custom_pattern(vibe);
}

static void vibe_notify_success(void) {
  vibe_play(s_vibe_success_pattern, VIBE_SUCCESS_SEGMENTS);
}

static void vibe_notify_error(void) {
  vibe_play(s_vibe_error_pattern, VIBE_ERROR_SEGMENTS);
}

static void vibe_notify_prompt_sent(void) {
  vibe_play(s_vibe_prompt_pattern, VIBE_PROMPT_SEGMENTS);
}

static void set_status(const char *text) {
  if (text == NULL) {
    text = "";
  }

  strncpy(s_status_text, text, sizeof(s_status_text) - 1);
  s_status_text[sizeof(s_status_text) - 1] = '\0';
  text_layer_set_text(s_status_layer, s_status_text);
}

static void reply_transfer_reset(void) {
  free(s_reply_accum);
  s_reply_accum = NULL;
  s_reply_accum_len = 0;
  s_expected_reply_parts = 0;
  s_expected_reply_bytes = 0;
  s_received_reply_parts = 0;
}

static void reply_accum_reset(void) {
  reply_transfer_reset();
}

static void reply_display_reset(void) {
  free(s_reply_display);
  s_reply_display = NULL;
}

static bool reply_accum_append(const char *chunk) {
  if (chunk == NULL) {
    return true;
  }

  size_t chunk_len = strlen(chunk);
  size_t new_len = s_reply_accum_len + chunk_len;
  char *resized = realloc(s_reply_accum, new_len + 1);

  if (resized == NULL) {
    return false;
  }

  s_reply_accum = resized;

  if (chunk_len > 0) {
    memcpy(s_reply_accum + s_reply_accum_len, chunk, chunk_len);
  }

  s_reply_accum_len = new_len;
  s_reply_accum[s_reply_accum_len] = '\0';
  return true;
}

static void reply_display_refresh(void) {
  const char *text = s_reply_display ? s_reply_display : "";
  const int scroll_width = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer)).size.w;

  text_layer_set_size(s_reply_layer, GSize(scroll_width, 20000));
  text_layer_set_text(s_reply_layer, text);

  GSize content_size = text_layer_get_content_size(s_reply_layer);
  if (content_size.h < REPLY_LINE_HEIGHT) {
    content_size.h = REPLY_LINE_HEIGHT;
  }

  text_layer_set_size(s_reply_layer, GSize(scroll_width, content_size.h));
  scroll_layer_set_content_size(s_scroll_layer, GSize(scroll_width, content_size.h));
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, 0), false);
  layer_set_hidden(text_layer_get_layer(s_reply_layer), false);
  layer_mark_dirty(text_layer_get_layer(s_reply_layer));
  layer_mark_dirty(scroll_layer_get_layer(s_scroll_layer));
}

static void reply_finalize(void) {
  char *previous_display = s_reply_display;

  if (s_reply_accum == NULL || s_reply_accum_len == 0) {
    if (s_expected_reply_parts > 0) {
      snprintf(s_status_text, sizeof(s_status_text),
               "Incomplete (%u/%u)",
               (unsigned)s_received_reply_parts,
               (unsigned)s_expected_reply_parts);
      text_layer_set_text(s_status_layer, s_status_text);
    } else {
      set_status("No reply received");
    }
    vibe_notify_error();
    reply_transfer_reset();
    s_hist_viewing = false;
    return;
  }

  s_reply_display = s_reply_accum;
  s_reply_accum = NULL;
  s_reply_accum_len = 0;
  s_expected_reply_parts = 0;
  s_expected_reply_bytes = 0;
  s_received_reply_parts = 0;

  reply_display_refresh();

  if (s_hist_viewing) {
    set_status("Historique Up/Down");
  } else {
    set_status("Up/Down to scroll");
  }
  vibe_notify_success();

  free(previous_display);
}

static void hist_labels_reset(void) {
  s_hist_count = 0;
  memset(s_hist_labels, 0, sizeof(s_hist_labels));
}

static void hist_labels_parse(const char *src) {
  char buf[HIST_LABELS_BUF];
  uint16_t parsed = 0;

  hist_labels_reset();

  if (src == NULL || src[0] == '\0') {
    return;
  }

  strncpy(buf, src, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';

  char *token = strtok(buf, "|");
  while (token != NULL && parsed < HIST_MAX_ITEMS) {
    strncpy(s_hist_labels[parsed], token, HIST_LABEL_CHARS - 1);
    s_hist_labels[parsed][HIST_LABEL_CHARS - 1] = '\0';
    parsed += 1;
    token = strtok(NULL, "|");
  }

  s_hist_count = parsed;
}

static void hist_labels_fill_missing(void) {
  uint16_t target = s_hist_expected_count;

  if (target > HIST_MAX_ITEMS) {
    target = HIST_MAX_ITEMS;
  }

  while (s_hist_count < target) {
    snprintf(s_hist_labels[s_hist_count], HIST_LABEL_CHARS, "#%u", (unsigned)(s_hist_count + 1));
    s_hist_count += 1;
  }

  if (s_hist_count > target) {
    s_hist_count = target;
  }
}

static void hist_browse_render(void) {
  char line[HIST_LABEL_CHARS + 4];
  char *cursor = s_hist_browse_text;
  char *end = s_hist_browse_text + sizeof(s_hist_browse_text);
  uint16_t i;

  if (s_hist_count == 0) {
    s_hist_browse_text[0] = '\0';
    text_layer_set_text(s_reply_layer, "");
    set_status("Historique vide");
    return;
  }

  if (s_hist_browse_index >= s_hist_count) {
    s_hist_browse_index = s_hist_count - 1;
  }

  for (i = 0; i < s_hist_count; i++) {
    snprintf(line, sizeof(line), "%s %s\n", (i == s_hist_browse_index) ? ">" : " ", s_hist_labels[i]);
    if (cursor + strlen(line) >= end) {
      break;
    }
    strcpy(cursor, line);
    cursor += strlen(line);
  }

  *cursor = '\0';
  text_layer_set_text(s_reply_layer, s_hist_browse_text);
  layer_mark_dirty(text_layer_get_layer(s_reply_layer));

  snprintf(s_status_text, sizeof(s_status_text), "Hist %u/%u SEL=read",
           (unsigned)(s_hist_browse_index + 1), (unsigned)s_hist_count);
  text_layer_set_text(s_status_layer, s_status_text);
}

static void hist_browse_enter(void) {
  if (s_hist_count == 0) {
    s_app_mode = APP_MODE_CHAT;
    return;
  }

  s_hist_browse_index = 0;
  s_app_mode = APP_MODE_HISTORY_BROWSE;
  hist_browse_render();
  action_bar_refresh_icons();
}

static void hist_browse_exit(void) {
  s_app_mode = APP_MODE_CHAT;
  reply_display_refresh();
  action_bar_refresh_icons();
#if defined(PBL_MICROPHONE)
  set_status("SELECT to speak");
#else
  set_status("No microphone");
#endif
}

static void hist_send_get(uint8_t index) {
  DictionaryIterator *out_iter = NULL;
  AppMessageResult result = app_message_outbox_begin(&out_iter);

  if (result != APP_MSG_OK || out_iter == NULL) {
    set_status("Cannot send");
    vibe_notify_error();
    s_hist_viewing = false;
    return;
  }

  if (dict_write_uint8(out_iter, MESSAGE_KEY_HIST_GET, index) != DICT_OK) {
    set_status("Cannot send");
    vibe_notify_error();
    s_hist_viewing = false;
    return;
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    set_status("Cannot send");
    vibe_notify_error();
    s_hist_viewing = false;
  }
}

static void hist_request_open(void) {
  DictionaryIterator *out_iter = NULL;
  AppMessageResult result = app_message_outbox_begin(&out_iter);

  if (result != APP_MSG_OK || out_iter == NULL) {
    set_status("Cannot send");
    vibe_notify_error();
    return;
  }

  if (dict_write_uint8(out_iter, MESSAGE_KEY_HIST_OPEN, 1) != DICT_OK) {
    set_status("Cannot send");
    vibe_notify_error();
    return;
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    set_status("Cannot send");
    vibe_notify_error();
    return;
  }

  s_app_mode = APP_MODE_HISTORY_WAIT;
  set_status("Historique...");
}

static void sidebar_draw_icon(GContext *ctx, GRect bounds, int row, const GBitmap *icon) {
  if (icon == NULL || row < 0 || row >= SIDEBAR_ROWS) {
    return;
  }

  const int row_h = bounds.size.h / SIDEBAR_ROWS;
  const GRect icon_bounds = gbitmap_get_bounds(icon);
  const GRect dest = GRect(
    bounds.origin.x + (bounds.size.w - icon_bounds.size.w) / 2,
    bounds.origin.y + row * row_h + (row_h - icon_bounds.size.h) / 2,
    icon_bounds.size.w,
    icon_bounds.size.h
  );

  graphics_draw_bitmap_in_rect(ctx, icon, dest);
}

static void sidebar_layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_compositing_mode(ctx, GCompOpSet);

  if (s_app_mode == APP_MODE_HISTORY_BROWSE) {
    sidebar_draw_icon(ctx, bounds, 0, s_icon_up);
    sidebar_draw_icon(ctx, bounds, 1, s_icon_read);
    sidebar_draw_icon(ctx, bounds, 2, s_icon_down);
    sidebar_draw_icon(ctx, bounds, 3, s_icon_back);
    return;
  }

  sidebar_draw_icon(ctx, bounds, 0, s_icon_up);
  sidebar_draw_icon(ctx, bounds, 1, s_icon_history);
  sidebar_draw_icon(ctx, bounds, 2, s_icon_mic);
  sidebar_draw_icon(ctx, bounds, 3, s_icon_down);
}

static void sidebar_load_icons(void) {
  if (s_icon_up == NULL) {
    s_icon_up = gbitmap_create_with_resource(RESOURCE_ID_ACTION_UP);
  }
  if (s_icon_down == NULL) {
    s_icon_down = gbitmap_create_with_resource(RESOURCE_ID_ACTION_DOWN);
  }
  if (s_icon_mic == NULL) {
    s_icon_mic = gbitmap_create_with_resource(RESOURCE_ID_ACTION_MIC);
  }
  if (s_icon_history == NULL) {
    s_icon_history = gbitmap_create_with_resource(RESOURCE_ID_ACTION_HISTORY);
  }
  if (s_icon_read == NULL) {
    s_icon_read = gbitmap_create_with_resource(RESOURCE_ID_ACTION_READ);
  }
  if (s_icon_back == NULL) {
    s_icon_back = gbitmap_create_with_resource(RESOURCE_ID_ACTION_BACK);
  }
}

static void sidebar_destroy_icons(void) {
  if (s_icon_up != NULL) {
    gbitmap_destroy(s_icon_up);
    s_icon_up = NULL;
  }
  if (s_icon_down != NULL) {
    gbitmap_destroy(s_icon_down);
    s_icon_down = NULL;
  }
  if (s_icon_mic != NULL) {
    gbitmap_destroy(s_icon_mic);
    s_icon_mic = NULL;
  }
  if (s_icon_history != NULL) {
    gbitmap_destroy(s_icon_history);
    s_icon_history = NULL;
  }
  if (s_icon_read != NULL) {
    gbitmap_destroy(s_icon_read);
    s_icon_read = NULL;
  }
  if (s_icon_back != NULL) {
    gbitmap_destroy(s_icon_back);
    s_icon_back = NULL;
  }
}

static void action_bar_refresh_icons(void) {
  if (s_action_bar == NULL) {
    return;
  }

  action_bar_layer_clear_icon(s_action_bar, BUTTON_ID_UP);
  action_bar_layer_clear_icon(s_action_bar, BUTTON_ID_SELECT);
  action_bar_layer_clear_icon(s_action_bar, BUTTON_ID_DOWN);

  if (s_sidebar_layer != NULL) {
    layer_mark_dirty(s_sidebar_layer);
  }
}

#if defined(PBL_MICROPHONE)
static void dictation_status_message(DictationSessionStatus status, char *buffer, size_t length) {
  switch (status) {
    case DictationSessionStatusFailureTranscriptionRejected:
      snprintf(buffer, length, "Transcription denied");
      break;
    case DictationSessionStatusFailureNoSpeechDetected:
      snprintf(buffer, length, "No speech detected");
      break;
    case DictationSessionStatusFailureConnectivityError:
      snprintf(buffer, length, "Network unavailable");
      break;
    case DictationSessionStatusFailureRecognizerError:
      snprintf(buffer, length, "Recognizer timeout");
      break;
    case DictationSessionStatusFailureDisabled:
      snprintf(buffer, length, "Dictation disabled");
      break;
    case DictationSessionStatusFailureSystemAborted:
      snprintf(buffer, length, "System busy");
      break;
    case DictationSessionStatusFailureInternalError:
      snprintf(buffer, length, "Too many requests");
      break;
    default:
      snprintf(buffer, length, "Dictation error");
      break;
  }
}

static void send_prompt(const char *transcript) {
  DictionaryIterator *out_iter = NULL;
  AppMessageResult result = app_message_outbox_begin(&out_iter);

  if (result != APP_MSG_OK || out_iter == NULL) {
    set_status("Cannot send");
    vibe_notify_error();
    return;
  }

  if (dict_write_cstring(out_iter, MESSAGE_KEY_PROMPT, transcript) != DICT_OK) {
    set_status("Cannot send");
    vibe_notify_error();
    return;
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    set_status("Cannot send");
    vibe_notify_error();
    return;
  }

  s_hist_viewing = false;
  vibe_notify_prompt_sent();
}

static void dictation_session_callback(DictationSession *session, DictationSessionStatus status,
                                       char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess) {
    if (transcription == NULL) {
      set_status("Empty transcript");
      vibe_notify_error();
      return;
    }

    strncpy(s_transcript, transcription, sizeof(s_transcript) - 1);
    s_transcript[sizeof(s_transcript) - 1] = '\0';

    reply_accum_reset();
    set_status("Thinking...");
    send_prompt(s_transcript);
    return;
  }

  char error_message[STATUS_TEXT_MAX];
  dictation_status_message(status, error_message, sizeof(error_message));
  set_status(error_message);
  vibe_notify_error();
}
#endif

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  Tuple *tuple = dict_find(iter, MESSAGE_KEY_VIBRATE_CFG);
  if (tuple != NULL) {
    s_vibrate_enabled = (tuple->value->uint32 != 0);
  }

  tuple = dict_find(iter, MESSAGE_KEY_VIBE);
  if (tuple != NULL) {
    if (tuple->value->uint32 == 1) {
      vibe_notify_success();
    } else if (tuple->value->uint32 == 2) {
      vibe_notify_error();
    }
  }

  tuple = dict_find(iter, MESSAGE_KEY_HIST_COUNT);
  if (tuple != NULL) {
    s_hist_expected_count = (uint16_t)tuple->value->uint32;

    if (s_hist_expected_count == 0) {
      s_app_mode = APP_MODE_CHAT;
    }
  }

  tuple = dict_find(iter, MESSAGE_KEY_HIST_LABELS);
  if (tuple != NULL && tuple->type == TUPLE_CSTRING && tuple->length > 0) {
    hist_labels_parse(tuple->value->cstring);
    hist_labels_fill_missing();
    hist_browse_enter();
  }

  tuple = dict_find(iter, MESSAGE_KEY_REPLY_PARTS);
  if (tuple != NULL) {
    s_expected_reply_parts = tuple->value->uint32;
    s_received_reply_parts = 0;
  }

  tuple = dict_find(iter, MESSAGE_KEY_REPLY_BYTES);
  if (tuple != NULL) {
    s_expected_reply_bytes = tuple->value->uint32;
  }

  tuple = dict_find(iter, MESSAGE_KEY_STATUS);
  if (tuple != NULL && tuple->type == TUPLE_CSTRING && tuple->length > 0) {
    set_status(tuple->value->cstring);
  }

  tuple = dict_find(iter, MESSAGE_KEY_REPLY_CHUNK);
  if (tuple != NULL && tuple->type == TUPLE_CSTRING && tuple->length > 0) {
    const char *chunk = tuple->value->cstring;
    if (chunk != NULL && chunk[0] != '\0') {
      if (!reply_accum_append(chunk)) {
        set_status("Out of memory");
        vibe_notify_error();
        reply_accum_reset();
        s_hist_viewing = false;
      } else {
        s_received_reply_parts += 1;
      }
    }
  }

  tuple = dict_find(iter, MESSAGE_KEY_REPLY_DONE);
  if (tuple != NULL) {
    reply_finalize();
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  set_status("Receive failed");
  vibe_notify_error();
  s_hist_viewing = false;
  s_app_mode = APP_MODE_CHAT;
}

static void outbox_failed_callback(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  set_status("Cannot send");
  vibe_notify_error();
  s_hist_viewing = false;
  s_app_mode = APP_MODE_CHAT;
}

static void scroll_reply_layer(int delta_y) {
  if (s_scroll_layer == NULL) {
    return;
  }

  GSize content_size = scroll_layer_get_content_size(s_scroll_layer);
  const int viewport_h = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer)).size.h;

  if (content_size.h <= viewport_h) {
    return;
  }

  GPoint offset = scroll_layer_get_content_offset(s_scroll_layer);
  const int max_y = content_size.h - viewport_h;
  int new_y = offset.y + delta_y;

  if (new_y < 0) {
    new_y = 0;
  } else if (new_y > max_y) {
    new_y = max_y;
  }

  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, new_y), true);
  layer_mark_dirty(scroll_layer_get_layer(s_scroll_layer));
}

static void back_short_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_app_mode == APP_MODE_HISTORY_BROWSE) {
    hist_browse_exit();
  }
}

static void up_double_click_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_app_mode == APP_MODE_HISTORY_WAIT || s_app_mode == APP_MODE_HISTORY_BROWSE) {
    return;
  }

  hist_request_open();
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_app_mode == APP_MODE_HISTORY_BROWSE) {
    s_hist_viewing = true;
    s_app_mode = APP_MODE_CHAT;
    reply_accum_reset();
    set_status("Chargement...");
    hist_send_get((uint8_t)s_hist_browse_index);
    return;
  }

#if defined(PBL_MICROPHONE)
  if (s_dictation_session == NULL) {
    set_status("Dictation unavailable");
    return;
  }

  set_status("Listening...");
  if (dictation_session_start(s_dictation_session) != DictationSessionStatusSuccess) {
    set_status("Dictation unavailable");
  }
#else
  set_status("No microphone");
#endif
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_app_mode == APP_MODE_HISTORY_BROWSE) {
    if (s_hist_browse_index > 0) {
      s_hist_browse_index -= 1;
      hist_browse_render();
    }
    return;
  }

  if (s_scroll_layer != NULL) {
    scroll_layer_scroll_up_click_handler(recognizer, s_scroll_layer);
    return;
  }
  scroll_reply_layer(-SCROLL_STEP_PX);
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_app_mode == APP_MODE_HISTORY_BROWSE) {
    if (s_hist_browse_index + 1 < s_hist_count) {
      s_hist_browse_index += 1;
      hist_browse_render();
    }
    return;
  }

  if (s_scroll_layer != NULL) {
    scroll_layer_scroll_down_click_handler(recognizer, s_scroll_layer);
    return;
  }
  scroll_reply_layer(SCROLL_STEP_PX);
}

static void action_bar_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_multi_click_subscribe(BUTTON_ID_UP, UP_DOUBLE_CLICK_MIN, UP_DOUBLE_CLICK_MAX,
                               UP_DOUBLE_CLICK_TIMEOUT_MS, true, up_double_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void main_window_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_BACK, back_short_click_handler);
}

static void window_appear(Window *window) {
  if (s_action_bar != NULL) {
    action_bar_layer_set_click_config_provider(s_action_bar, action_bar_click_config_provider);
  }
}

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  const int16_t content_w = bounds.size.w - ACTION_BAR_WIDTH;

  window_set_click_config_provider(window, main_window_click_config_provider);

  s_status_layer = text_layer_create(GRect(0, 0, bounds.size.w, STATUS_HEIGHT));
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  s_scroll_layer = scroll_layer_create(GRect(0, STATUS_HEIGHT, content_w, bounds.size.h - STATUS_HEIGHT));
  scroll_layer_set_context(s_scroll_layer, s_scroll_layer);

  s_reply_layer = text_layer_create(GRect(0, 0, content_w, bounds.size.h - STATUS_HEIGHT));
  text_layer_set_font(s_reply_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));
  text_layer_set_overflow_mode(s_reply_layer, GTextOverflowModeWordWrap);
  text_layer_set_background_color(s_reply_layer, GColorBlack);
  text_layer_set_text_color(s_reply_layer, GColorWhite);
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_reply_layer));
  layer_add_child(window_layer, scroll_layer_get_layer(s_scroll_layer));

  s_action_bar = action_bar_layer_create();
  action_bar_layer_add_to_window(s_action_bar, window);
  action_bar_layer_set_click_config_provider(s_action_bar, action_bar_click_config_provider);
  action_bar_layer_set_background_color(s_action_bar, GColorBlack);

  sidebar_load_icons();
  {
    Layer *bar_layer = action_bar_layer_get_layer(s_action_bar);
    GRect bar_bounds = layer_get_bounds(bar_layer);
    s_sidebar_layer = layer_create(bar_bounds);
    layer_set_update_proc(s_sidebar_layer, sidebar_layer_update);
    layer_add_child(bar_layer, s_sidebar_layer);
  }

  action_bar_refresh_icons();

#if defined(PBL_MICROPHONE)
  set_status("SELECT speak Upx2 hist");
#else
  set_status("No microphone");
#endif
}

static void window_unload(Window *window) {
  sidebar_destroy_icons();

  if (s_action_bar != NULL) {
    action_bar_layer_remove_from_window(s_action_bar);
    action_bar_layer_destroy(s_action_bar);
    s_action_bar = NULL;
    s_sidebar_layer = NULL;
  }

  text_layer_set_text(s_reply_layer, "");
  text_layer_destroy(s_reply_layer);
  scroll_layer_destroy(s_scroll_layer);
  text_layer_destroy(s_status_layer);

  reply_accum_reset();
  reply_display_reset();
}

static void init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
    .appear = window_appear,
  });

  window_stack_push(s_window, true);

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);

  uint32_t outbox_size = app_message_outbox_size_maximum();
  if (outbox_size < OUTBOX_SIZE_MIN) {
    outbox_size = OUTBOX_SIZE_MIN;
  }
  app_message_open(INBOX_SIZE, outbox_size);

#if defined(PBL_MICROPHONE)
  s_dictation_session = dictation_session_create(TRANSCRIPT_MAX, dictation_session_callback, NULL);
  if (s_dictation_session == NULL) {
    set_status("Dictation unavailable");
  }
#endif
}

static void deinit(void) {
#if defined(PBL_MICROPHONE)
  if (s_dictation_session != NULL) {
    dictation_session_destroy(s_dictation_session);
    s_dictation_session = NULL;
  }
#endif

  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
