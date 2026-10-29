/*
 * Auric runtime shim for the PC preview. The Auric compiler emits calls to
 * aur_* helpers; this file maps them onto the same SDL runtime that the C SDK
 * preview uses.
 */

#include <aurora_app.h>
#include <auric_runtime.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_aur_screen = AUR_TOP;
static uint32_t g_aur_bg[2];
static int g_aur_buffered;

void aur_screen(int which) {
  g_aur_screen = which == AUR_BOTTOM ? AUR_BOTTOM : AUR_TOP;
}

static Screen aur_screen_id(void) {
  return g_aur_screen == AUR_BOTTOM ? SCREEN_BOTTOM : SCREEN_TOP;
}

void aur_print(const char *text, int x, int y, int color) {
  gfx_text(aur_screen_id(), x, y, (uint32_t)color & 0xFFFFFFu,
           "%s", text ? text : "");
}

void aur_print_int(int value, int x, int y, int color) {
  gfx_text(aur_screen_id(), x, y, (uint32_t)color & 0xFFFFFFu, "%d", value);
}

void aur_clear(int color) {
  g_aur_bg[g_aur_screen == AUR_BOTTOM ? 1 : 0] = (uint32_t)color & 0xFFFFFFu;
  gfx_clear(aur_screen_id(), (uint32_t)color & 0xFFFFFFu);
}

void aur_fill_rect(int x, int y, int w, int h, int color) {
  gfx_rect(aur_screen_id(), x, y, w, h, (uint32_t)color & 0xFFFFFFu);
}

void aur_wait_key(int button) {
  hid_wait((uint32_t)button);
}

void aur_delay(int cycles) {
  volatile int i;
  if (cycles < 0) cycles = 0;
  for (i = 0; i < cycles; i++) {
    /* Busy-wait, like the device runtime. */
  }
}

int aur_keys_down(void) { return (int)hid_keys_down(); }
int aur_keys_held(void) { return (int)hid_keys_held(); }

void aur_buffered(int on) { g_aur_buffered = on != 0; }

void aur_present(void) {
  (void)g_aur_buffered;
  gfx_present();
}

int aur_rand(int n) {
  if (n <= 0) return 0;
  return rand() % n;
}

int aur_millis(void) { return (int)sys_millis(); }

int aur_touch_down(void) { return hid_touch_down() ? 1 : 0; }
int aur_touch_held(void) { return hid_touch_held() ? 1 : 0; }
int aur_touch_up(void) { return hid_touch_up() ? 1 : 0; }
int aur_touch_x(void) { return hid_touch_x(); }
int aur_touch_y(void) { return hid_touch_y(); }

int aur_touch_in(int x, int y, int w, int h) {
  return hid_touch_in(x, y, w, h) ? 1 : 0;
}

void aur_check_home(void) {}

int aur_str_eq(const char *a, const char *b) {
  return strcmp(a ? a : "", b ? b : "") == 0;
}

/* Sound is silent in the preview. */
int aur_load_sound(const char *path) { (void)path; return -1; }
void aur_play_sound(int handle) { (void)handle; }
void aur_play_music(int handle) { (void)handle; }
void aur_stop_music(void) {}
void aur_stop_sounds(void) {}

/* Network is not available in the preview. */
int aur_net_connect(void) { return 0; }
int aur_net_online(void) { return 0; }
const char *aur_net_error(void) { return net_error(); }
const char *aur_net_address(void) { return net_address(); }
int aur_http_get(const char *url) { (void)url; return 0; }
int aur_http_post(const char *url, const char *body) {
  (void)url; (void)body; return 0;
}
void aur_http_param(const char *name, const char *value) {
  (void)name; (void)value;
}
void aur_http_param_int(const char *name, int value) {
  (void)name; (void)value;
}
void aur_http_header(const char *name, const char *value) {
  (void)name; (void)value;
}
const char *aur_http_text(void) { return ""; }
int aur_http_length(void) { return 0; }
int aur_http_lines(void) { return 0; }
const char *aur_http_line(int n) { (void)n; return ""; }
int aur_http_save(const char *path) { (void)path; return 0; }
int aur_http_download(const char *url, const char *path) {
  (void)url; (void)path; return 0;
}

int aur_json_has(const char *path) { (void)path; return 0; }
int aur_json_int(const char *path) { (void)path; return 0; }
float aur_json_float(const char *path) { (void)path; return 0.0f; }
int aur_json_bool(const char *path) { (void)path; return 0; }
const char *aur_json_string(const char *path) { (void)path; return ""; }
int aur_json_count(const char *path) { (void)path; return 0; }
void aur_json_index(int n) { (void)n; }
