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

#define VIBE_SUCCESS_SEGMENTS 5
#define VIBE_ERROR_SEGMENTS 3
#define VIBE_PROMPT_SEGMENTS 1

static Window *s_window;
static TextLayer *s_status_layer;
static ScrollLayer *s_scroll_layer;
static TextLayer *s_reply_layer;
static BitmapLayer *s_logo_layer;

static char s_status_text[STATUS_TEXT_MAX];

static char *s_reply_accum = NULL;
static size_t s_reply_accum_len = 0;
static char *s_reply_display = NULL;
static uint32_t s_expected_reply_parts = 0;
static uint32_t s_expected_reply_bytes = 0;
static uint32_t s_received_reply_parts = 0;
static bool s_vibrate_enabled = true;

static const uint32_t s_vibe_success_pattern[] = { 80, 80, 120, 80, 200 };
static const uint32_t s_vibe_error_pattern[] = { 200, 120, 280 };
static const uint32_t s_vibe_prompt_pattern[] = { 60 };

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
static char s_transcript[TRANSCRIPT_MAX];
#endif

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

static bool status_indicates_waiting(const char *text) {
  if (text == NULL || text[0] == '\0') {
    return false;
  }

  return strstr(text, "Thinking") != NULL
      || strstr(text, "Hermes") != NULL
      || strstr(text, "Sending") != NULL
      || strstr(text, "Transfer") != NULL;
}

static void waiting_ui_set_visible(bool visible) {
  if (s_logo_layer != NULL) {
    layer_set_hidden(bitmap_layer_get_layer(s_logo_layer), !visible);
  }

  if (s_scroll_layer != NULL) {
    layer_set_hidden(scroll_layer_get_layer(s_scroll_layer), visible);
  }
}

static void set_status(const char *text) {
  if (text == NULL) {
    text = "";
  }

  strncpy(s_status_text, text, sizeof(s_status_text) - 1);
  s_status_text[sizeof(s_status_text) - 1] = '\0';
  text_layer_set_text(s_status_layer, s_status_text);
  waiting_ui_set_visible(status_indicates_waiting(text));
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
    return;
  }

  s_reply_display = s_reply_accum;
  s_reply_accum = NULL;
  s_reply_accum_len = 0;
  s_expected_reply_parts = 0;
  s_expected_reply_bytes = 0;
  s_received_reply_parts = 0;

  const char *text = s_reply_display;
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

  waiting_ui_set_visible(false);
  set_status("Up/Down to scroll");
  vibe_notify_success();

  free(previous_display);
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
}

static void outbox_failed_callback(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  set_status("Cannot send");
  vibe_notify_error();
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

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
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
  if (s_scroll_layer != NULL) {
    scroll_layer_scroll_up_click_handler(recognizer, s_scroll_layer);
    return;
  }
  scroll_reply_layer(-SCROLL_STEP_PX);
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_scroll_layer != NULL) {
    scroll_layer_scroll_down_click_handler(recognizer, s_scroll_layer);
    return;
  }
  scroll_reply_layer(SCROLL_STEP_PX);
}

static void main_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  const int16_t content_w = bounds.size.w;

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

  GBitmap *logo_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_HERMES_LOGO);
  GSize logo_size = gbitmap_get_bounds(logo_bitmap).size;
  const int16_t logo_x = (content_w - logo_size.w) / 2;
  const int16_t logo_y = STATUS_HEIGHT + (bounds.size.h - STATUS_HEIGHT - logo_size.h) / 2;
  s_logo_layer = bitmap_layer_create(GRect(logo_x, logo_y, logo_size.w, logo_size.h));
  bitmap_layer_set_bitmap(s_logo_layer, logo_bitmap);
  bitmap_layer_set_background_color(s_logo_layer, GColorClear);
  gbitmap_destroy(logo_bitmap);
  layer_add_child(window_layer, bitmap_layer_get_layer(s_logo_layer));
  layer_set_hidden(bitmap_layer_get_layer(s_logo_layer), true);

  window_set_click_config_provider(window, main_click_config_provider);

#if defined(PBL_MICROPHONE)
  set_status("SELECT to speak");
#else
  set_status("No microphone");
#endif
}

static void window_unload(Window *window) {
  if (s_logo_layer != NULL) {
    bitmap_layer_destroy(s_logo_layer);
    s_logo_layer = NULL;
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
