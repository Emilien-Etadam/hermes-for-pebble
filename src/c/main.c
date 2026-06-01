#include <pebble.h>
#include <stdlib.h>
#include <string.h>

#define INBOX_SIZE 2048
#define OUTBOX_SIZE_MIN 512
#define STATUS_HEIGHT 28
#define STATUS_TEXT_MAX 128
#define TRANSCRIPT_MAX 512
#define REPLY_LINE_HEIGHT 28

static Window *s_window;
static TextLayer *s_status_layer;
static ScrollLayer *s_scroll_layer;
static TextLayer *s_reply_layer;
static ActionBarLayer *s_action_bar;

static char s_status_text[STATUS_TEXT_MAX];

static char *s_reply_accum = NULL;
static size_t s_reply_accum_len = 0;
static char *s_reply_display = NULL;
static uint32_t s_expected_reply_parts = 0;
static uint32_t s_expected_reply_bytes = 0;
static uint32_t s_received_reply_parts = 0;

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
static char s_transcript[TRANSCRIPT_MAX];
#endif

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

static void reply_finalize(void) {
  char *previous_display = s_reply_display;

  if (s_reply_accum == NULL || s_reply_accum_len == 0) {
    if (s_expected_reply_parts > 0) {
      snprintf(s_status_text, sizeof(s_status_text),
               "Transfert incomplet (%u/%u)",
               (unsigned)s_received_reply_parts,
               (unsigned)s_expected_reply_parts);
      text_layer_set_text(s_status_layer, s_status_text);
    } else {
      set_status("Réponse non reçue");
    }
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
  const GRect scroll_bounds = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer));
  const int scroll_width = scroll_bounds.size.w;
  const int viewport_h = scroll_bounds.size.h;

  text_layer_set_size(s_reply_layer, GSize(scroll_width, 20000));
  text_layer_set_text(s_reply_layer, text);

  GSize content_size = text_layer_get_content_size(s_reply_layer);
  if (content_size.h < viewport_h) {
    content_size.h = viewport_h;
  }
  if (content_size.h < REPLY_LINE_HEIGHT) {
    content_size.h = REPLY_LINE_HEIGHT;
  }

  text_layer_set_size(s_reply_layer, GSize(scroll_width, content_size.h));
  scroll_layer_set_content_size(s_scroll_layer, GSize(scroll_width, content_size.h));
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, 0), false);

  layer_set_hidden(text_layer_get_layer(s_reply_layer), false);
  layer_mark_dirty(text_layer_get_layer(s_reply_layer));
  layer_mark_dirty(scroll_layer_get_layer(s_scroll_layer));

  set_status("Haut/Bas defiler");

  free(previous_display);
}

#if defined(PBL_MICROPHONE)
static void dictation_status_message(DictationSessionStatus status, char *buffer, size_t length) {
  switch (status) {
    case DictationSessionStatusFailureTranscriptionRejected:
      snprintf(buffer, length, "Transcription refusée");
      break;
    case DictationSessionStatusFailureNoSpeechDetected:
      snprintf(buffer, length, "Aucune voix détectée");
      break;
    case DictationSessionStatusFailureConnectivityError:
      snprintf(buffer, length, "Réseau indisponible");
      break;
    case DictationSessionStatusFailureRecognizerError:
      snprintf(buffer, length, "Délai dépassé");
      break;
    case DictationSessionStatusFailureDisabled:
      snprintf(buffer, length, "Dictée désactivée");
      break;
    case DictationSessionStatusFailureSystemAborted:
      snprintf(buffer, length, "Système occupé");
      break;
    case DictationSessionStatusFailureInternalError:
      snprintf(buffer, length, "Trop de requêtes");
      break;
    default:
      snprintf(buffer, length, "Erreur de dictée");
      break;
  }
}

static void send_prompt(const char *transcript) {
  DictionaryIterator *out_iter = NULL;
  AppMessageResult result = app_message_outbox_begin(&out_iter);

  if (result != APP_MSG_OK || out_iter == NULL) {
    set_status("Envoi impossible");
    return;
  }

  if (dict_write_cstring(out_iter, MESSAGE_KEY_PROMPT, transcript) != DICT_OK) {
    set_status("Envoi impossible");
    return;
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    set_status("Envoi impossible");
  }
}

static void dictation_session_callback(DictationSession *session, DictationSessionStatus status,
                                       char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess) {
    if (transcription == NULL) {
      set_status("Transcription vide");
      return;
    }

    strncpy(s_transcript, transcription, sizeof(s_transcript) - 1);
    s_transcript[sizeof(s_transcript) - 1] = '\0';

    reply_accum_reset();
    set_status("Réflexion…");
    send_prompt(s_transcript);
    return;
  }

  char error_message[STATUS_TEXT_MAX];
  dictation_status_message(status, error_message, sizeof(error_message));
  set_status(error_message);
}
#endif

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  Tuple *tuple = dict_find(iter, MESSAGE_KEY_REPLY_PARTS);
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
        set_status("Mémoire insuffisante");
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
  set_status("Réception interrompue");
}

static void outbox_failed_callback(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  set_status("Envoi impossible");
}

static void scroll_by(int delta_y) {
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
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
#if defined(PBL_MICROPHONE)
  if (s_dictation_session == NULL) {
    set_status("Dictée indisponible");
    return;
  }

  set_status("Écoute…");
  if (dictation_session_start(s_dictation_session) != DictationSessionStatusSuccess) {
    set_status("Dictée indisponible");
  }
#else
  set_status("Micro indisponible");
#endif
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_scroll_layer == NULL) {
    return;
  }

  const int viewport_h = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer)).size.h;
  scroll_by(-(viewport_h / 2));
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_scroll_layer == NULL) {
    return;
  }

  const int viewport_h = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer)).size.h;
  scroll_by(viewport_h / 2);
}

static void main_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void window_appear(Window *window) {
  if (s_action_bar != NULL) {
    action_bar_layer_set_click_config_provider(s_action_bar, main_click_config_provider);
  }
}

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  const int16_t content_w = bounds.size.w - ACTION_BAR_WIDTH;

  s_status_layer = text_layer_create(GRect(0, 0, bounds.size.w, STATUS_HEIGHT));
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  s_scroll_layer = scroll_layer_create(GRect(0, STATUS_HEIGHT, content_w, bounds.size.h - STATUS_HEIGHT));

  s_reply_layer = text_layer_create(GRect(0, 0, content_w, bounds.size.h - STATUS_HEIGHT));
  text_layer_set_font(s_reply_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));
  text_layer_set_overflow_mode(s_reply_layer, GTextOverflowModeWordWrap);
  text_layer_set_background_color(s_reply_layer, GColorBlack);
  text_layer_set_text_color(s_reply_layer, GColorWhite);
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_reply_layer));
  layer_add_child(window_layer, scroll_layer_get_layer(s_scroll_layer));

  s_action_bar = action_bar_layer_create();
  action_bar_layer_add_to_window(s_action_bar, window);
  action_bar_layer_set_click_config_provider(s_action_bar, main_click_config_provider);
  action_bar_layer_set_background_color(s_action_bar, GColorBlack);

#if defined(PBL_MICROPHONE)
  set_status("SELECT parler");
#else
  set_status("Micro indisponible");
#endif
}

static void window_unload(Window *window) {
  if (s_action_bar != NULL) {
    action_bar_layer_remove_from_window(s_action_bar);
    action_bar_layer_destroy(s_action_bar);
    s_action_bar = NULL;
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
    set_status("Dictée indisponible");
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
