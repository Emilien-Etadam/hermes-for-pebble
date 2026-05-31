#include <pebble.h>
#include <stdlib.h>
#include <string.h>

#define INBOX_SIZE 2048
#define OUTBOX_SIZE_MIN 512
#define STATUS_HEIGHT 28
#define STATUS_TEXT_MAX 128
#define TRANSCRIPT_MAX 512
#define PAIR_CODE_LEN 5
#define PAIR_HINT_MAX 48

typedef enum {
  PairingStateWaiting = 0,
  PairingStateConnected,
  PairingStateOk,
  PairingStateExpired
} PairingState;

static Window *s_window;
static TextLayer *s_status_layer;
static ScrollLayer *s_scroll_layer;
static TextLayer *s_reply_layer;

static Window *s_pairing_window;
static TextLayer *s_pairing_title_layer;
static TextLayer *s_pairing_code_layer;
static TextLayer *s_pairing_state_layer;
static TextLayer *s_pairing_hint_layer;

static char s_status_text[STATUS_TEXT_MAX];
static char s_pair_code[PAIR_CODE_LEN];
static char s_pair_hint[PAIR_HINT_MAX];
static bool s_in_pairing_mode = false;
static PairingState s_pairing_state = PairingStateWaiting;

// Accumulation buffer for streaming REPLY_CHUNK values.
static char *s_reply_accum = NULL;
static size_t s_reply_accum_len = 0;

// Persistent buffer shown in the reply TextLayer (text_layer keeps a pointer, not a copy).
static char *s_reply_display = NULL;

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
static char s_transcript[TRANSCRIPT_MAX];
#endif

static const char *pairing_state_text(PairingState state) {
  switch (state) {
    case PairingStateConnected:
      return "Connecté...";
    case PairingStateOk:
      return "OK";
    case PairingStateExpired:
      return "Expiration";
    case PairingStateWaiting:
    default:
      return "En attente...";
  }
}

static void set_status(const char *text) {
  if (text == NULL) {
    text = "";
  }

  strncpy(s_status_text, text, sizeof(s_status_text) - 1);
  s_status_text[sizeof(s_status_text) - 1] = '\0';
  text_layer_set_text(s_status_layer, s_status_text);
}

static void pairing_update_state(PairingState state) {
  s_pairing_state = state;
  if (s_pairing_state_layer != NULL) {
    text_layer_set_text(s_pairing_state_layer, pairing_state_text(state));
  }
}

static void pairing_update_code_display(void) {
  if (s_pairing_code_layer == NULL) {
    return;
  }

  if (s_pair_code[0] == '\0') {
    text_layer_set_text(s_pairing_code_layer, "----");
  } else {
    text_layer_set_text(s_pairing_code_layer, s_pair_code);
  }
}

static void pairing_update_hint_display(void) {
  if (s_pairing_hint_layer != NULL) {
    text_layer_set_text(s_pairing_hint_layer, s_pair_hint);
  }
}

static void pairing_set_hint(const char *hint) {
  if (hint == NULL) {
    s_pair_hint[0] = '\0';
  } else {
    strncpy(s_pair_hint, hint, sizeof(s_pair_hint) - 1);
    s_pair_hint[sizeof(s_pair_hint) - 1] = '\0';
  }
  pairing_update_hint_display();
}

static void pairing_set_code(const char *code) {
  if (code == NULL) {
    s_pair_code[0] = '\0';
  } else {
    strncpy(s_pair_code, code, sizeof(s_pair_code) - 1);
    s_pair_code[sizeof(s_pair_code) - 1] = '\0';
  }
  pairing_update_code_display();

  if (s_pair_code[0] != '\0') {
    char cli_hint[PAIR_HINT_MAX];
    snprintf(cli_hint, sizeof(cli_hint), "CLI Hermes: /pair %s", s_pair_code);
    pairing_set_hint(cli_hint);
  }
}

static void send_pairing_message(uint32_t key) {
  DictionaryIterator *out_iter = NULL;
  AppMessageResult result = app_message_outbox_begin(&out_iter);

  if (result != APP_MSG_OK || out_iter == NULL) {
    set_status("Envoi impossible");
    return;
  }

  if (dict_write_uint8(out_iter, key, 1) != DICT_OK) {
    set_status("Envoi impossible");
    return;
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    set_status("Envoi impossible");
  }
}

static void send_pairing_start(void) {
  send_pairing_message(MESSAGE_KEY_PAIRING_START);
}

static void send_pairing_stop(void) {
  send_pairing_message(MESSAGE_KEY_PAIRING_STOP);
}

static void pairing_exit(void) {
  send_pairing_stop();
  s_in_pairing_mode = false;
  s_pair_code[0] = '\0';
  pairing_update_code_display();
  pairing_set_hint("");
  pairing_update_state(PairingStateWaiting);

  if (s_pairing_window != NULL && window_stack_contains_window(s_pairing_window)) {
    window_stack_pop(true);
  }
}

static void pairing_handle_status(const char *status) {
  if (status == NULL || !s_in_pairing_mode) {
    return;
  }

  if (strcmp(status, "Connecté...") == 0) {
    pairing_update_state(PairingStateConnected);
    return;
  }

  if (strcmp(status, "Appairage réussi") == 0) {
    pairing_update_state(PairingStateOk);
    return;
  }

  if (strcmp(status, "Expiration") == 0) {
    pairing_update_state(PairingStateExpired);
    return;
  }

  if (strcmp(status, "Serveur requis (Settings)") == 0) {
    pairing_update_state(PairingStateWaiting);
    pairing_set_hint("Settings: IP serveur");
  }
}

static void pairing_enter(void) {
  s_in_pairing_mode = true;
  s_pair_code[0] = '\0';
  pairing_update_code_display();
  pairing_set_hint("Generation du code...");
  pairing_update_state(PairingStateWaiting);
  send_pairing_start();

  if (s_pairing_window != NULL) {
    window_stack_push(s_pairing_window, true);
  }
}

static void reply_accum_reset(void) {
  free(s_reply_accum);
  s_reply_accum = NULL;
  s_reply_accum_len = 0;
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

  if (s_reply_accum != NULL && s_reply_accum_len > 0) {
    s_reply_display = s_reply_accum;
    s_reply_accum = NULL;
    s_reply_accum_len = 0;
  } else {
    s_reply_display = NULL;
  }

  const char *text = s_reply_display != NULL ? s_reply_display : "";
  const int scroll_width = layer_get_bounds(scroll_layer_get_layer(s_scroll_layer)).size.w;
  const GSize max_size = GSize(scroll_width, 20000);

  text_layer_set_size(s_reply_layer, max_size);
  text_layer_set_text(s_reply_layer, text);

  GSize content_size = text_layer_get_content_size(s_reply_layer);
  text_layer_set_size(s_reply_layer, GSize(scroll_width, content_size.h));
  scroll_layer_set_content_size(s_scroll_layer, content_size);
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, 0), false);

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
  Tuple *tuple = dict_find(iter, MESSAGE_KEY_PAIR_CODE);
  if (tuple && tuple->length > 1) {
    pairing_set_code(tuple->value->cstring);
    pairing_update_state(PairingStateWaiting);

    if (!s_in_pairing_mode) {
      s_in_pairing_mode = true;
      if (s_pairing_window != NULL) {
        window_stack_push(s_pairing_window, true);
      }
    }
  }

  tuple = dict_find(iter, MESSAGE_KEY_STATUS);
  if (tuple && tuple->length > 1) {
    const char *status = tuple->value->cstring;
    if (s_in_pairing_mode) {
      pairing_handle_status(status);
    } else {
      set_status(status);
    }
  }

  tuple = dict_find(iter, MESSAGE_KEY_REPLY_CHUNK);
  if (tuple && tuple->length > 1) {
    const char *s = tuple->value->cstring;
    if (!reply_accum_append(s)) {
      set_status("Mémoire insuffisante");
      reply_accum_reset();
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
  if (s_in_pairing_mode) {
    return;
  }
  pairing_enter();
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
}

static void pairing_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  pairing_exit();
}

static void pairing_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  pairing_exit();
}

static void pairing_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, pairing_select_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, pairing_back_click_handler);
}

static void pairing_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_pairing_title_layer = text_layer_create(GRect(0, 20, bounds.size.w, 28));
  text_layer_set_font(s_pairing_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_pairing_title_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_pairing_title_layer, GColorBlack);
  text_layer_set_text_color(s_pairing_title_layer, GColorWhite);
  text_layer_set_text(s_pairing_title_layer, "Appairage");
  layer_add_child(window_layer, text_layer_get_layer(s_pairing_title_layer));

  s_pairing_code_layer = text_layer_create(GRect(0, 58, bounds.size.w, 48));
  text_layer_set_font(s_pairing_code_layer, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD));
  text_layer_set_text_alignment(s_pairing_code_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_pairing_code_layer, GColorBlack);
  text_layer_set_text_color(s_pairing_code_layer, GColorWhite);
  text_layer_set_text(s_pairing_code_layer, "----");
  layer_add_child(window_layer, text_layer_get_layer(s_pairing_code_layer));

  s_pairing_state_layer = text_layer_create(GRect(0, 112, bounds.size.w, 24));
  text_layer_set_font(s_pairing_state_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_pairing_state_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_pairing_state_layer, GColorBlack);
  text_layer_set_text_color(s_pairing_state_layer, GColorWhite);
  text_layer_set_text(s_pairing_state_layer, pairing_state_text(s_pairing_state));
  layer_add_child(window_layer, text_layer_get_layer(s_pairing_state_layer));

  s_pairing_hint_layer = text_layer_create(GRect(0, 140, bounds.size.w, 36));
  text_layer_set_font(s_pairing_hint_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_pairing_hint_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_pairing_hint_layer, GColorBlack);
  text_layer_set_text_color(s_pairing_hint_layer, GColorWhite);
  text_layer_set_text(s_pairing_hint_layer, s_pair_hint);
  layer_add_child(window_layer, text_layer_get_layer(s_pairing_hint_layer));

  pairing_update_code_display();
  pairing_update_hint_display();
}

static void pairing_window_unload(Window *window) {
  text_layer_destroy(s_pairing_hint_layer);
  s_pairing_hint_layer = NULL;
  text_layer_destroy(s_pairing_state_layer);
  s_pairing_state_layer = NULL;
  text_layer_destroy(s_pairing_code_layer);
  s_pairing_code_layer = NULL;
  text_layer_destroy(s_pairing_title_layer);
  s_pairing_title_layer = NULL;
}

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_status_layer = text_layer_create(GRect(0, 0, bounds.size.w, STATUS_HEIGHT));
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  s_scroll_layer = scroll_layer_create(GRect(0, STATUS_HEIGHT, bounds.size.w, bounds.size.h - STATUS_HEIGHT));
  scroll_layer_set_click_config_onto_window(s_scroll_layer, window);

  s_reply_layer = text_layer_create(GRect(0, 0, bounds.size.w, bounds.size.h - STATUS_HEIGHT));
  text_layer_set_font(s_reply_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));
  text_layer_set_overflow_mode(s_reply_layer, GTextOverflowModeWordWrap);
  text_layer_set_background_color(s_reply_layer, GColorClear);
  text_layer_set_text_color(s_reply_layer, GColorWhite);
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_reply_layer));

#if defined(PBL_MICROPHONE)
  set_status("SELECT parler · UP appairer");
#else
  set_status("Micro indisponible");
#endif
}

static void window_unload(Window *window) {
  text_layer_set_text(s_reply_layer, "");
  text_layer_destroy(s_reply_layer);
  scroll_layer_destroy(s_scroll_layer);
  text_layer_destroy(s_status_layer);

  reply_accum_reset();
  reply_display_reset();
}

static void init(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });

  s_pairing_window = window_create();
  window_set_click_config_provider(s_pairing_window, pairing_click_config_provider);
  window_set_window_handlers(s_pairing_window, (WindowHandlers) {
    .load = pairing_window_load,
    .unload = pairing_window_unload,
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

  window_destroy(s_pairing_window);
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
