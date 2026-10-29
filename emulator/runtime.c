/*
 * AuroraOS PC preview runtime.
 *
 * A small SDL2 host implementation of the AuroraOS C app SDK
 * (sdk/include/aurora_app.h). It draws both screens in one window, maps the
 * keyboard and mouse to the 3DS pad/touchscreen, and maps SD-card paths to a
 * folder on the host so apps can save data.
 *
 * Build:
 *   cc -std=c11 -O2 -I. -I<sdk>/sdk/include runtime.c app.c ... \
 *      $(pkg-config --cflags --libs sdl2) -lm
 *
 * Environment:
 *   AURORA_PREVIEW_SD   host folder that stands in for the SD card
 *   AURORA_APP_PATH     value returned by app_path()
 *   AURORA_APP_DIR      value returned by app_dir()
 */

#include <aurora_app.h>

#include <SDL2/SDL.h>
#ifdef AURORA_HAVE_SDL_IMAGE
#include <SDL2/SDL_image.h>
#endif

#include <dirent.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#include "font8x8.h"

#define TOP_W 400
#define TOP_H 240
#define BOT_W 320
#define BOT_H 240
#define MAX_W 400
#define MAX_H 240

#define WIN_W 680
#define WIN_H 880
#define SCALE 1.5f
#define TOP_X 40
#define TOP_Y 44
#define TOP_DW ((int)(TOP_W * SCALE))
#define TOP_DH ((int)(TOP_H * SCALE))
#define BOT_X ((WIN_W - (int)(BOT_W * SCALE)) / 2)
#define BOT_Y 460
#define BOT_DW ((int)(BOT_W * SCALE))
#define BOT_DH ((int)(BOT_H * SCALE))

static uint32_t g_fb[2][MAX_W * MAX_H];
static uint8_t g_raw[2][MAX_W * MAX_H * 3];

static SDL_Window *g_win;
static SDL_Renderer *g_ren;
static SDL_Texture *g_tex[2];
static int g_sdl_ready;
static int g_quit;
static int g_app_quit;
static uint32_t g_start_ticks;
static uint32_t g_last_present;
static uint32_t g_fps_start;
static unsigned g_fps_frames;
static unsigned g_fps_value;

static uint32_t g_held;
static uint32_t g_prev_held;
static uint32_t g_down;
static uint32_t g_up;
static int g_touch_held;
static int g_touch_prev;
static int g_touch_down;
static int g_touch_up;
static int g_touch_x = -1;
static int g_touch_y = -1;
static int g_mouse_down;

static uint32_t g_text_bg[2];

static char g_app_path[1024];
static char g_app_dir[1024];
static char g_sd_root[1024];

/* ------------------------------------------------------------------ */
/* small helpers                                                      */

static int screen_w(int s) { return s == SCREEN_BOTTOM ? BOT_W : TOP_W; }
static uint32_t *fb_for(int s) {
  return s == SCREEN_BOTTOM ? g_fb[1] : g_fb[0];
}

static void put_px(int s, int x, int y, uint32_t c) {
  int w = screen_w(s);
  if ((unsigned)x >= (unsigned)w || (unsigned)y >= (unsigned)MAX_H) return;
  fb_for(s)[y * w + x] = c & 0xFFFFFFu;
}

static uint32_t get_px(int s, int x, int y) {
  int w = screen_w(s);
  if ((unsigned)x >= (unsigned)w || (unsigned)y >= (unsigned)MAX_H) return 0;
  return fb_for(s)[y * w + x] & 0xFFFFFFu;
}

static void blend_px(int s, int x, int y, uint32_t c, int a) {
  int w = screen_w(s);
  uint32_t *p;
  uint32_t d;
  int r, g, b;
  if ((unsigned)x >= (unsigned)w || (unsigned)y >= (unsigned)MAX_H) return;
  if (a <= 0) return;
  p = &fb_for(s)[y * w + x];
  if (a >= 255) { *p = c & 0xFFFFFFu; return; }
  d = *p;
  r = (int)((c >> 16) & 255) * a + (int)((d >> 16) & 255) * (255 - a);
  g = (int)((c >> 8) & 255) * a + (int)((d >> 8) & 255) * (255 - a);
  b = (int)(c & 255) * a + (int)(d & 255) * (255 - a);
  *p = ((uint32_t)(r / 255) << 16) | ((uint32_t)(g / 255) << 8) |
       (uint32_t)(b / 255);
}

static void clip_rect(int s, int *x, int *y, int *w, int *h) {
  int sw = screen_w(s);
  if (*x < 0) { *w += *x; *x = 0; }
  if (*y < 0) { *h += *y; *y = 0; }
  if (*x + *w > sw) *w = sw - *x;
  if (*y + *h > MAX_H) *h = MAX_H - *y;
  if (*w < 0) *w = 0;
  if (*h < 0) *h = 0;
}

static void draw_glyph(int s, int x, int y, unsigned char c, uint32_t color,
                       int scale) {
  const uint8_t *g;
  int row, col, i;
  if (c < 0x20 || c > 0x7E) return;
  g = font8x8[c - 0x20];
  for (row = 0; row < 8; row++) {
    uint8_t bits = g[row];
    for (col = 0; bits && col < 8; col++) {
      if (!(bits & (0x80 >> col))) continue;
      for (i = 0; i < scale; i++) {
        int yy;
        for (yy = 0; yy < scale; yy++)
          put_px(s, x + col * scale + i, y + row * scale + yy, color);
      }
    }
  }
}

static int text_scale(GfxFont f) {
  return f == FONT_TITLE ? 2 : 1;
}

static int draw_text(int s, int x, int y, int scale, uint32_t color,
                     const char *t) {
  int cx = x, widest = 0, cell = 8 * scale;
  for (; t && *t; t++) {
    unsigned char c = (unsigned char)*t;
    if (c == '\n') {
      if (cx - x > widest) widest = cx - x;
      cx = x;
      y += 8 * scale;
    } else if (c == '\t') {
      cx = x + ((cx - x) / (4 * cell) + 1) * 4 * cell;
    } else if ((c & 0xC0u) != 0x80u) {
      draw_glyph(s, cx, y, c, color, scale);
      cx += cell;
    }
  }
  return cx - x > widest ? cx - x : widest;
}

static const char *vformat(char *buf, size_t n, const char *fmt, va_list ap) {
  vsnprintf(buf, n, fmt, ap);
  return buf;
}

/* ------------------------------------------------------------------ */
/* window and input                                                   */

static void render_frame(void) {
  SDL_Rect top = {TOP_X, TOP_Y, TOP_DW, TOP_DH};
  SDL_Rect bot = {BOT_X, BOT_Y, BOT_DW, BOT_DH};
  SDL_Rect top_frame = {24, 12, 632, 400};
  SDL_Rect bot_frame = {24, 428, 632, 400};

  if (!g_sdl_ready) return;
  SDL_UpdateTexture(g_tex[0], NULL, g_fb[0], TOP_W * 4);
  SDL_UpdateTexture(g_tex[1], NULL, g_fb[1], BOT_W * 4);

  SDL_SetRenderDrawColor(g_ren, 8, 13, 23, 255);
  SDL_RenderClear(g_ren);

  /* plastic */
  SDL_SetRenderDrawColor(g_ren, 27, 39, 56, 255);
  SDL_RenderFillRect(g_ren, &top_frame);
  SDL_RenderFillRect(g_ren, &bot_frame);
  SDL_SetRenderDrawColor(g_ren, 53, 69, 89, 255);
  {
    SDL_Rect a = {27, 15, 626, 394};
    SDL_Rect b = {27, 431, 626, 394};
    SDL_RenderFillRect(g_ren, &a);
    SDL_RenderFillRect(g_ren, &b);
  }
  SDL_SetRenderDrawColor(g_ren, 13, 20, 31, 255);
  {
    SDL_Rect a = {31, 19, 618, 386};
    SDL_Rect b = {31, 435, 618, 386};
    SDL_RenderFillRect(g_ren, &a);
    SDL_RenderFillRect(g_ren, &b);
  }
  SDL_RenderCopy(g_ren, g_tex[0], NULL, &top);
  SDL_RenderCopy(g_ren, g_tex[1], NULL, &bot);

  SDL_SetRenderDrawColor(g_ren, 143, 235, 183, 255);
  {
    SDL_Rect led = {WIN_W - 48, 22, 7, 7};
    SDL_RenderFillRect(g_ren, &led);
  }
  g_fps_frames++;
  {
    uint32_t now = SDL_GetTicks();
    if (now - g_fps_start >= 1000) {
      g_fps_value = (unsigned)(g_fps_frames * 1000u / (now - g_fps_start));
      g_fps_frames = 0;
      g_fps_start = now;
    }
  }
  SDL_RenderPresent(g_ren);
}

static int ensure_window(void) {
  int i;
  if (g_sdl_ready) return 1;
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) != 0) {
    fprintf(stderr, "Aurora preview: SDL_Init failed: %s\n", SDL_GetError());
    return 0;
  }
  g_win = SDL_CreateWindow("Aurora3DS Studio - PC preview",
                           SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                           WIN_W, WIN_H, SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE);
  if (!g_win) {
    fprintf(stderr, "Aurora preview: window failed: %s\n", SDL_GetError());
    return 0;
  }
  g_ren = SDL_CreateRenderer(g_win, -1, SDL_RENDERER_ACCELERATED);
  if (!g_ren) g_ren = SDL_CreateRenderer(g_win, -1, SDL_RENDERER_SOFTWARE);
  if (!g_ren) {
    fprintf(stderr, "Aurora preview: renderer failed: %s\n", SDL_GetError());
    return 0;
  }
  for (i = 0; i < 2; i++) {
    int w = i ? BOT_W : TOP_W;
    g_tex[i] = SDL_CreateTexture(g_ren, SDL_PIXELFORMAT_ARGB8888,
                                 SDL_TEXTUREACCESS_STREAMING, w, MAX_H);
    if (!g_tex[i]) {
      fprintf(stderr, "Aurora preview: texture failed: %s\n", SDL_GetError());
      return 0;
    }
  }
  g_start_ticks = SDL_GetTicks();
  g_fps_start = g_start_ticks;
  g_sdl_ready = 1;
  return 1;
}

static uint32_t map_key(SDL_Keycode k) {
  switch (k) {
    case SDLK_a: return KEY_A;
    case SDLK_b: return KEY_B;
    case SDLK_x: return KEY_X;
    case SDLK_y: return KEY_Y;
    case SDLK_UP: return KEY_UP;
    case SDLK_DOWN: return KEY_DOWN;
    case SDLK_LEFT: return KEY_LEFT;
    case SDLK_RIGHT: return KEY_RIGHT;
    case SDLK_q: return KEY_L;
    case SDLK_e: return KEY_R;
    case SDLK_RETURN:
    case SDLK_KP_ENTER:
    case SDLK_SPACE: return KEY_START;
    case SDLK_BACKSPACE: return KEY_SELECT;
    default: return 0;
  }
}

static void set_touch_from_window(int px, int py) {
  if (px >= BOT_X && px < BOT_X + BOT_DW &&
      py >= BOT_Y && py < BOT_Y + BOT_DH) {
    int x = (int)((px - BOT_X) / SCALE);
    int y = (int)((py - BOT_Y) / SCALE);
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= BOT_W) x = BOT_W - 1;
    if (y >= BOT_H) y = BOT_H - 1;
    g_touch_x = x;
    g_touch_y = y;
    g_touch_held = 1;
  } else {
    g_touch_held = 0;
  }
}

void hid_scan(void) {
  SDL_Event e;
  uint32_t held = 0;
  int touch = 0;

  if (!ensure_window()) { g_quit = 1; return; }
  while (SDL_PollEvent(&e)) {
    if (e.type == SDL_QUIT) g_quit = 1;
    else if (e.type == SDL_KEYDOWN) {
      if (e.key.keysym.sym == SDLK_ESCAPE) g_quit = 1;
      else if (!e.key.repeat) held |= map_key(e.key.keysym.sym);
    } else if (e.type == SDL_KEYUP) {
      /* released bits are dropped below by rebuilding from the keyboard */
    } else if (e.type == SDL_MOUSEBUTTONDOWN && e.button.button == SDL_BUTTON_LEFT) {
      g_mouse_down = 1;
      set_touch_from_window(e.button.x, e.button.y);
      touch = g_touch_held;
    } else if (e.type == SDL_MOUSEBUTTONUP && e.button.button == SDL_BUTTON_LEFT) {
      g_mouse_down = 0;
      g_touch_held = 0;
      touch = 0;
    } else if (e.type == SDL_MOUSEMOTION && g_mouse_down) {
      set_touch_from_window(e.motion.x, e.motion.y);
      touch = g_touch_held;
    }
  }

  /* Keyboard state is level-based, so a lost KEYUP cannot stick a button. */
  {
    const Uint8 *ks = SDL_GetKeyboardState(NULL);
    if (ks[SDL_SCANCODE_A]) held |= KEY_A;
    if (ks[SDL_SCANCODE_B]) held |= KEY_B;
    if (ks[SDL_SCANCODE_X]) held |= KEY_X;
    if (ks[SDL_SCANCODE_Y]) held |= KEY_Y;
    if (ks[SDL_SCANCODE_UP]) held |= KEY_UP;
    if (ks[SDL_SCANCODE_DOWN]) held |= KEY_DOWN;
    if (ks[SDL_SCANCODE_LEFT]) held |= KEY_LEFT;
    if (ks[SDL_SCANCODE_RIGHT]) held |= KEY_RIGHT;
    if (ks[SDL_SCANCODE_Q]) held |= KEY_L;
    if (ks[SDL_SCANCODE_E]) held |= KEY_R;
    if (ks[SDL_SCANCODE_RETURN] || ks[SDL_SCANCODE_KP_ENTER] ||
        ks[SDL_SCANCODE_SPACE]) held |= KEY_START;
    if (ks[SDL_SCANCODE_BACKSPACE]) held |= KEY_SELECT;
  }
  if (touch) held |= KEY_TOUCH;

  g_down = held & ~g_prev_held;
  g_up = g_prev_held & ~held;
  g_prev_held = held;
  g_held = held;

  g_touch_down = touch && !g_touch_prev;
  g_touch_up = !touch && g_touch_prev;
  g_touch_prev = touch;
  if (!touch && g_touch_held) g_touch_held = 0;
}

bool app_loop(void) {
  if (g_quit || g_app_quit) return false;
  gfx_present();
  hid_scan();
  return !g_quit && !g_app_quit;
}

void app_quit(void) { g_app_quit = 1; }

int app_fps(void) { return (int)g_fps_value; }

bool app_from_home(void) { return true; }

const char *app_path(void) {
  if (!g_app_path[0]) {
    const char *p = getenv("AURORA_APP_PATH");
    snprintf(g_app_path, sizeof(g_app_path), "%s",
             p && *p ? p : "/Aurora/Apps/C/Preview.bin");
  }
  return g_app_path;
}

static void ensure_sd_root(void) {
  const char *r;
  if (g_sd_root[0]) return;
  r = getenv("AURORA_PREVIEW_SD");
  if (!r || !*r) r = ".preview/sd";
  snprintf(g_sd_root, sizeof(g_sd_root), "%s", r);
  mkdir(g_sd_root, 0755);
}

static void resolve_sd(const char *path, char *out, size_t n) {
  const char *p = path ? path : "";
  size_t rootlen;
  ensure_sd_root();
  rootlen = strlen(g_sd_root);
  if (rootlen && strncmp(p, g_sd_root, rootlen) == 0 &&
      (p[rootlen] == '/' || p[rootlen] == '\0')) {
    snprintf(out, n, "%s", p);
    return;
  }
  if (strncmp(p, "sdmc:", 5) == 0) p += 5;
  else if (p[0] == '0' && p[1] == ':') p += 2;
  while (*p == '/' || *p == '\\') p++;
  snprintf(out, n, "%s/%s", g_sd_root, p);
}

const char *app_dir(void) {
  if (!g_app_dir[0]) {
    const char *d = getenv("AURORA_APP_DIR");
    if (!d || !*d) d = "/Aurora/Apps/C/Preview";
    snprintf(g_app_dir, sizeof(g_app_dir), "%s", d);
  }
  return g_app_dir;
}

/* ------------------------------------------------------------------ */
/* drawing                                                            */

int gfx_width(Screen s) { return screen_w(s); }

void gfx_clear(Screen s, uint32_t color) {
  int i, n = screen_w(s) * MAX_H;
  uint32_t *fb = fb_for(s);
  for (i = 0; i < n; i++) fb[i] = color & 0xFFFFFFu;
  g_text_bg[s == SCREEN_BOTTOM ? 1 : 0] = color;
}

void gfx_pixel(Screen s, int x, int y, uint32_t color) {
  put_px(s, x, y, color);
}

uint32_t gfx_get_pixel(Screen s, int x, int y) { return get_px(s, x, y); }

void gfx_rect(Screen s, int x, int y, int w, int h, uint32_t color) {
  int yy;
  clip_rect(s, &x, &y, &w, &h);
  for (yy = y; yy < y + h; yy++) {
    int xx;
    for (xx = x; xx < x + w; xx++) put_px(s, xx, yy, color);
  }
}

void gfx_rect_blend(Screen s, int x, int y, int w, int h, uint32_t color,
                    int alpha) {
  int yy;
  clip_rect(s, &x, &y, &w, &h);
  for (yy = y; yy < y + h; yy++) {
    int xx;
    for (xx = x; xx < x + w; xx++) blend_px(s, xx, yy, color, alpha);
  }
}

void gfx_rect_outline(Screen s, int x, int y, int w, int h, int t,
                      uint32_t color) {
  if (t < 1) t = 1;
  gfx_rect(s, x, y, w, t, color);
  gfx_rect(s, x, y + h - t, w, t, color);
  gfx_rect(s, x, y + t, t, h - 2 * t, color);
  gfx_rect(s, x + w - t, y + t, t, h - 2 * t, color);
}

void gfx_round_rect(Screen s, int x, int y, int w, int h, int r,
                    uint32_t color) {
  int yy;
  if (r < 0) r = 0;
  if (r * 2 > w) r = w / 2;
  if (r * 2 > h) r = h / 2;
  for (yy = 0; yy < h; yy++) {
    int inset = 0;
    if (yy < r) {
      int dy = r - yy - 1;
      inset = r - (int)sqrt((double)(r * r - dy * dy));
    } else if (yy >= h - r) {
      int dy = yy - (h - r);
      inset = r - (int)sqrt((double)(r * r - dy * dy));
    }
    gfx_rect(s, x + inset, y + yy, w - inset * 2, 1, color);
  }
}

void gfx_gradient(Screen s, int x, int y, int w, int h, uint32_t top,
                  uint32_t bottom) {
  int yy;
  if (h <= 0) return;
  for (yy = 0; yy < h; yy++) {
    double t = h > 1 ? (double)yy / (h - 1) : 0.0;
    int r = (int)(((top >> 16) & 255) * (1 - t) + ((bottom >> 16) & 255) * t);
    int g = (int)(((top >> 8) & 255) * (1 - t) + ((bottom >> 8) & 255) * t);
    int b = (int)((top & 255) * (1 - t) + (bottom & 255) * t);
    gfx_rect(s, x, y + yy, w, 1,
             ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b);
  }
}

void gfx_line(Screen s, int x0, int y0, int x1, int y1, uint32_t color) {
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  int dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  for (;;) {
    put_px(s, x0, y0, color);
    if (x0 == x1 && y0 == y1) break;
    {
      int e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

void gfx_circle(Screen s, int cx, int cy, int r, uint32_t color) {
  int dy;
  if (r < 0) r = -r;
  for (dy = -r; dy <= r; dy++) {
    int dx = (int)sqrt((double)(r * r - dy * dy));
    gfx_rect(s, cx - dx, cy + dy, dx * 2 + 1, 1, color);
  }
}

void gfx_circle_outline(Screen s, int cx, int cy, int r, uint32_t color) {
  int x = r, y = 0, err = 1 - r;
  if (r < 0) r = -r;
  while (x >= y) {
    put_px(s, cx + x, cy + y, color);
    put_px(s, cx + y, cy + x, color);
    put_px(s, cx - y, cy + x, color);
    put_px(s, cx - x, cy + y, color);
    put_px(s, cx - x, cy - y, color);
    put_px(s, cx - y, cy - x, color);
    put_px(s, cx + y, cy - x, color);
    put_px(s, cx + x, cy - y, color);
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x) + 1; }
  }
}

static void fill_triangle(Screen s, int x0, int y0, int x1, int y1, int x2,
                          int y2, uint32_t color) {
  int minx = x0 < x1 ? (x0 < x2 ? x0 : x2) : (x1 < x2 ? x1 : x2);
  int maxx = x0 > x1 ? (x0 > x2 ? x0 : x2) : (x1 > x2 ? x1 : x2);
  int miny = y0 < y1 ? (y0 < y2 ? y0 : y2) : (y1 < y2 ? y1 : y2);
  int maxy = y0 > y1 ? (y0 > y2 ? y0 : y2) : (y1 > y2 ? y1 : y2);
  int x, y;
  int area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area == 0) {
    gfx_line(s, x0, y0, x1, y1, color);
    gfx_line(s, x1, y1, x2, y2, color);
    gfx_line(s, x2, y2, x0, y0, color);
    return;
  }
  for (y = miny; y <= maxy; y++) {
    for (x = minx; x <= maxx; x++) {
      int w0 = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
      int w1 = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
      int w2 = (x0 - x2) * (y - y2) - (y0 - y2) * (x - x2);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) ||
          (w0 <= 0 && w1 <= 0 && w2 <= 0))
        put_px(s, x, y, color);
    }
  }
}

void gfx_triangle(Screen s, int x0, int y0, int x1, int y1, int x2, int y2,
                  uint32_t color) {
  fill_triangle(s, x0, y0, x1, y1, x2, y2, color);
}

int gfx_text(Screen s, int x, int y, uint32_t color, const char *fmt, ...) {
  char buf[2048];
  va_list ap;
  va_start(ap, fmt);
  vformat(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  return draw_text(s, x, y, 1, color, buf);
}

int gfx_text_scaled(Screen s, int x, int y, int scale, uint32_t color,
                    const char *fmt, ...) {
  char buf[2048];
  va_list ap;
  va_start(ap, fmt);
  vformat(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  return draw_text(s, x, y, scale < 1 ? 1 : scale, color, buf);
}

int gfx_print(Screen s, int x, int y, GfxFont font, uint32_t color,
              const char *fmt, ...) {
  char buf[2048];
  va_list ap;
  va_start(ap, fmt);
  vformat(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  return draw_text(s, x, y, text_scale(font), color, buf);
}

int gfx_text_width(GfxFont font, const char *text) {
  int scale = text_scale(font), widest = 0, line = 0;
  const char *p;
  for (p = text; p && *p; p++) {
    if (*p == '\n') {
      if (line > widest) widest = line;
      line = 0;
    } else if ((*p & 0xC0) != 0x80) {
      line += 8 * scale;
    }
  }
  return line > widest ? line : widest;
}

int gfx_line_height(GfxFont font) { return 8 * text_scale(font); }

bool gfx_fonts_loaded(void) { return false; }

void gfx_present(void) {
  uint32_t now;
  if (!ensure_window()) { g_quit = 1; return; }
  now = SDL_GetTicks();
  if (g_last_present && now - g_last_present < 16)
    SDL_Delay(16 - (now - g_last_present));
  g_last_present = SDL_GetTicks();
  render_frame();
}

uint8_t *gfx_framebuffer(Screen s) {
  int idx = s == SCREEN_BOTTOM ? 1 : 0;
  int w = screen_w(s), x, y;
  uint8_t *p = g_raw[idx];
  for (x = 0; x < w; x++) {
    for (y = 0; y < MAX_H; y++) {
      uint32_t c = fb_for(s)[y * w + x];
      p[((x * MAX_H) + (MAX_H - 1 - y)) * 3 + 0] = (uint8_t)(c & 255);
      p[((x * MAX_H) + (MAX_H - 1 - y)) * 3 + 1] = (uint8_t)((c >> 8) & 255);
      p[((x * MAX_H) + (MAX_H - 1 - y)) * 3 + 2] = (uint8_t)((c >> 16) & 255);
    }
  }
  return p;
}

void gfx_mark(Screen s) {
  int idx = s == SCREEN_BOTTOM ? 1 : 0;
  int w = screen_w(s), x, y;
  uint8_t *p = g_raw[idx];
  for (x = 0; x < w; x++) {
    for (y = 0; y < MAX_H; y++) {
      int i = ((x * MAX_H) + (MAX_H - 1 - y)) * 3;
      fb_for(s)[y * w + x] = ((uint32_t)p[i + 2] << 16) |
                             ((uint32_t)p[i + 1] << 8) | p[i];
    }
  }
}

/* ------------------------------------------------------------------ */
/* images                                                             */

static const char *g_img_error = "";

const char *gfx_image_error(void) { return g_img_error; }

GfxImage *gfx_image_new(int w, int h) {
  GfxImage *img;
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096) {
    g_img_error = "bad image size";
    return NULL;
  }
  img = (GfxImage *)malloc(sizeof(*img));
  if (!img) { g_img_error = "out of memory"; return NULL; }
  img->w = w;
  img->h = h;
  img->pixels = (uint32_t *)calloc((size_t)w * (size_t)h, sizeof(uint32_t));
  if (!img->pixels) {
    free(img);
    g_img_error = "out of memory";
    return NULL;
  }
  return img;
}

void gfx_image_free(GfxImage *img) {
  if (!img) return;
  free(img->pixels);
  free(img);
}

static GfxImage *image_from_surface(SDL_Surface *surf) {
  SDL_Surface *conv;
  GfxImage *img;
  int x, y;
  if (!surf) return NULL;
  conv = SDL_ConvertSurfaceFormat(surf, SDL_PIXELFORMAT_ARGB8888, 0);
  SDL_FreeSurface(surf);
  if (!conv) { g_img_error = "could not convert image"; return NULL; }
  img = gfx_image_new(conv->w, conv->h);
  if (!img) { SDL_FreeSurface(conv); return NULL; }
  for (y = 0; y < conv->h; y++) {
    uint32_t *row = (uint32_t *)((uint8_t *)conv->pixels + y * conv->pitch);
    for (x = 0; x < conv->w; x++) {
      uint32_t p = row[x];
      /* SDL gives ARGB; keep the same 0xAARRGGBB layout. */
      img->pixels[y * conv->w + x] = p;
    }
  }
  SDL_FreeSurface(conv);
  return img;
}

GfxImage *gfx_image_load(const char *path) {
  char host[1200];
  SDL_Surface *surf;
  GfxImage *img;
  const char *ext;
  resolve_sd(path, host, sizeof(host));
  ext = strrchr(host, '.');
  if (ext && (strcasecmp(ext, ".bmp") == 0)) {
    surf = SDL_LoadBMP(host);
  } else {
#ifdef AURORA_HAVE_SDL_IMAGE
    surf = IMG_Load(host);
#else
    g_img_error = "PNG/JPEG preview needs SDL2_image; use BMP or install it";
    return NULL;
#endif
  }
  if (!surf) {
    g_img_error = SDL_GetError();
    return NULL;
  }
  img = image_from_surface(surf);
  if (img) g_img_error = "";
  return img;
}

static void draw_image_part(Screen s, const GfxImage *img, int sx, int sy,
                            int sw, int sh, int dx, int dy, int dw, int dh) {
  int x, y;
  if (!img || !img->pixels || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  for (y = 0; y < dh; y++) {
    int src_y = sy + (int)((long)y * sh / dh);
    for (x = 0; x < dw; x++) {
      int src_x = sx + (int)((long)x * sw / dw);
      uint32_t p;
      if (src_x < 0 || src_y < 0 || src_x >= img->w || src_y >= img->h) continue;
      p = img->pixels[src_y * img->w + src_x];
      blend_px(s, dx + x, dy + y, p & 0xFFFFFFu, (int)((p >> 24) & 255));
    }
  }
}

void gfx_image(Screen s, const GfxImage *img, int x, int y) {
  if (!img) return;
  draw_image_part(s, img, 0, 0, img->w, img->h, x, y, img->w, img->h);
}

void gfx_image_part(Screen s, const GfxImage *img, int sx, int sy, int sw,
                    int sh, int x, int y) {
  draw_image_part(s, img, sx, sy, sw, sh, x, y, sw, sh);
}

void gfx_image_scaled(Screen s, const GfxImage *img, int x, int y, int w,
                      int h) {
  if (!img) return;
  draw_image_part(s, img, 0, 0, img->w, img->h, x, y, w, h);
}

/* ------------------------------------------------------------------ */
/* console (minimal)                                                  */

static int g_con_screen = SCREEN_TOP;
static int g_con_col;
static int g_con_row;
static uint32_t g_con_fg = 0xFFFFFF;
static uint32_t g_con_bg = 0x000000;

void con_init(Screen s) {
  g_con_screen = s;
  g_con_col = 0;
  g_con_row = 0;
  gfx_clear(s, g_con_bg);
}

void con_clear(void) {
  g_con_col = 0;
  g_con_row = 0;
  gfx_clear(g_con_screen, g_con_bg);
}

void con_color(uint32_t fg, uint32_t bg) {
  g_con_fg = fg;
  g_con_bg = bg;
}

void con_move(int col, int row) {
  g_con_col = col < 0 ? 0 : col;
  g_con_row = row < 0 ? 0 : row;
}

int con_cols(void) { return g_con_screen == SCREEN_BOTTOM ? 40 : 50; }
int con_rows(void) { return 30; }

/* ------------------------------------------------------------------ */
/* input queries                                                      */

uint32_t hid_keys_down(void) { return g_down; }
uint32_t hid_keys_held(void) { return g_held; }
uint32_t hid_keys_up(void) { return g_up; }

bool hid_touch_held(void) { return g_touch_held != 0; }
bool hid_touch_down(void) { return g_touch_down != 0; }
bool hid_touch_up(void) { return g_touch_up != 0; }
int hid_touch_x(void) { return g_touch_x; }
int hid_touch_y(void) { return g_touch_y; }

bool hid_touch_in(int x, int y, int w, int h) {
  return g_touch_held && g_touch_x >= x && g_touch_y >= y &&
         g_touch_x < x + w && g_touch_y < y + h;
}

void hid_cpad(int *x, int *y) {
  int dx = 0, dy = 0;
  if (g_held & KEY_CPAD_RIGHT) dx = 127;
  if (g_held & KEY_CPAD_LEFT) dx = -127;
  if (g_held & KEY_CPAD_UP) dy = 127;
  if (g_held & KEY_CPAD_DOWN) dy = -127;
  /* Also let the arrow keys nudge the circle pad when an app asks for it. */
  if (!dx && (g_held & KEY_RIGHT)) dx = 127;
  if (!dx && (g_held & KEY_LEFT)) dx = -127;
  if (!dy && (g_held & KEY_UP)) dy = 127;
  if (!dy && (g_held & KEY_DOWN)) dy = -127;
  if (x) *x = dx;
  if (y) *y = dy;
}

uint32_t hid_wait(uint32_t keys) {
  for (;;) {
    uint32_t got;
    gfx_present();
    hid_scan();
    if (g_quit || g_app_quit) return 0;
    got = g_down & keys;
    if (got) return got;
    if ((keys & KEY_TOUCH) && g_touch_down) return KEY_TOUCH;
    SDL_Delay(16);
  }
}

/* ------------------------------------------------------------------ */
/* files                                                              */

struct FsDir {
  DIR *dir;
  char path[1200];
};

static void make_parents(const char *file) {
  char tmp[1200];
  char *p;
  snprintf(tmp, sizeof(tmp), "%s", file);
  for (p = tmp + 1; *p; p++) {
    if (*p == '/' || *p == '\\') {
      *p = '\0';
      mkdir(tmp, 0755);
      *p = '/';
    }
  }
}

FsDir *fs_dir_open(const char *path) {
  char host[1200];
  DIR *d;
  FsDir *out;
  resolve_sd(path, host, sizeof(host));
  d = opendir(host);
  if (!d) return NULL;
  out = (FsDir *)calloc(1, sizeof(*out));
  if (!out) { closedir(d); return NULL; }
  out->dir = d;
  snprintf(out->path, sizeof(out->path), "%s", host);
  return out;
}

bool fs_dir_read(FsDir *dir, FsEntry *entry) {
  struct dirent *de;
  struct stat st;
  char full[2048];
  if (!dir || !dir->dir || !entry) return false;
  while ((de = readdir(dir->dir)) != NULL) {
    if (strcmp(de->d_name, ".") == 0 || strcmp(de->d_name, "..") == 0)
      continue;
    snprintf(full, sizeof(full), "%s/%s", dir->path, de->d_name);
    if (stat(full, &st) != 0) continue;
    snprintf(entry->name, sizeof(entry->name), "%s", de->d_name);
    entry->size = (uint32_t)(st.st_size < 0 ? 0 : st.st_size);
    entry->is_dir = S_ISDIR(st.st_mode);
    return true;
  }
  return false;
}

void fs_dir_close(FsDir *dir) {
  if (!dir) return;
  if (dir->dir) closedir(dir->dir);
  free(dir);
}

void *fs_read_file(const char *path, size_t *size) {
  char host[1200];
  FILE *f;
  long n;
  void *data;
  resolve_sd(path, host, sizeof(host));
  f = fopen(host, "rb");
  if (!f) return NULL;
  if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
  n = ftell(f);
  if (n < 0) { fclose(f); return NULL; }
  rewind(f);
  data = malloc((size_t)n + 1);
  if (!data) { fclose(f); return NULL; }
  if (n > 0 && fread(data, 1, (size_t)n, f) != (size_t)n) {
    free(data);
    fclose(f);
    return NULL;
  }
  ((unsigned char *)data)[n] = 0;
  fclose(f);
  if (size) *size = (size_t)n;
  return data;
}

bool fs_write_file(const char *path, const void *data, size_t size) {
  char host[1200];
  FILE *f;
  resolve_sd(path, host, sizeof(host));
  make_parents(host);
  f = fopen(host, "wb");
  if (!f) return false;
  if (size && fwrite(data, 1, size, f) != size) {
    fclose(f);
    return false;
  }
  return fclose(f) == 0;
}

bool fs_exists(const char *path) {
  char host[1200];
  struct stat st;
  resolve_sd(path, host, sizeof(host));
  return stat(host, &st) == 0;
}

bool fs_is_dir(const char *path) {
  char host[1200];
  struct stat st;
  resolve_sd(path, host, sizeof(host));
  return stat(host, &st) == 0 && S_ISDIR(st.st_mode);
}

bool fs_mkdir(const char *path) {
  char host[1200];
  char tmp[1200];
  char *p;
  resolve_sd(path, host, sizeof(host));
  snprintf(tmp, sizeof(tmp), "%s", host);
  for (p = tmp + 1; *p; p++) {
    if (*p == '/' || *p == '\\') {
      *p = '\0';
      mkdir(tmp, 0755);
      *p = '/';
    }
  }
  mkdir(tmp, 0755);
  return fs_is_dir(path);
}

bool fs_available(void) { return true; }

/* ------------------------------------------------------------------ */
/* time and system                                                    */

uint32_t sys_millis(void) {
  if (!g_start_ticks) g_start_ticks = SDL_GetTicks();
  return SDL_GetTicks() - g_start_ticks;
}

uint64_t sys_micros(void) { return (uint64_t)sys_millis() * 1000ull; }

void sys_sleep(uint32_t ms) { SDL_Delay(ms); }

bool sys_time(SysTime *t) {
  time_t now = time(NULL);
  struct tm lt;
  if (!t || !localtime_r(&now, &lt)) return false;
  t->year = lt.tm_year + 1900;
  t->month = lt.tm_mon + 1;
  t->day = lt.tm_mday;
  t->hour = lt.tm_hour;
  t->minute = lt.tm_min;
  t->second = lt.tm_sec;
  t->weekday = lt.tm_wday;
  return true;
}

int sys_battery(void) { return 100; }
int sys_battery_tenths(void) { return 1000; }
bool sys_charging(void) { return false; }
int sys_battery_temperature(void) { return SYS_TEMP_UNKNOWN; }
int sys_battery_millivolts(void) { return 4200; }
bool sys_is_new3ds(void) { return false; }
const char *sys_user_name(void) { return "Player"; }
SysLanguage sys_language(void) { return SYS_LANG_ENGLISH; }
uint32_t sys_accent(void) { return 0x64E8C8u; }

void sys_power_off(void) { exit(0); }
void sys_reboot(void) { exit(0); }

/* ------------------------------------------------------------------ */
/* sound (silent in the preview)                                      */

int snd_load(const char *path) { (void)path; return -1; }
void snd_play(int sound) { (void)sound; }
void snd_play_volume(int sound, int volume) { (void)sound; (void)volume; }
void snd_music(int sound) { (void)sound; }
void snd_music_volume(int sound, int volume) { (void)sound; (void)volume; }
void snd_stop_music(void) {}
void snd_stop_sounds(void) {}
void snd_unload_all(void) {}
bool snd_available(void) { return false; }

/* ------------------------------------------------------------------ */
/* network (not available in the preview)                             */

static const char *g_net_error = "network is not available in the PC preview";
static void (*g_net_wait)(uint32_t) = NULL;

bool net_available(void) { return false; }
bool net_connect(void) { return false; }
bool net_connected(void) { return false; }
const char *net_error(void) { return g_net_error; }
const char *net_address(void) { return ""; }
bool net_resolve(const char *host, char ip[16]) { (void)host; if (ip) ip[0] = 0; return false; }
int net_ping(const char *host) { (void)host; return -1; }
void net_on_wait(void (*fn)(uint32_t ms)) { g_net_wait = fn; }
int net_tcp_exchange(const char *host, int port, const void *data,
                     size_t length, void *reply, size_t max) {
  (void)host; (void)port; (void)data; (void)length; (void)reply; (void)max;
  return -1;
}
HttpResponse *http_get(const char *url) { (void)url; return NULL; }
HttpResponse *http_post(const char *url, const char *content_type,
                        const void *data, size_t length) {
  (void)url; (void)content_type; (void)data; (void)length;
  return NULL;
}
HttpResponse *http_request(const char *method, const char *url,
                           const char *headers, const void *data,
                           size_t length) {
  (void)method; (void)url; (void)headers; (void)data; (void)length;
  return NULL;
}
bool http_header(const HttpResponse *r, const char *name, char *value,
                 size_t max) {
  (void)r; (void)name;
  if (value && max) value[0] = 0;
  return false;
}
void http_free(HttpResponse *r) { (void)r; }
bool http_download(const char *url, const char *path,
                   void (*progress)(size_t done, size_t total)) {
  (void)url; (void)path; (void)progress;
  return false;
}
size_t http_url_encode(char *out, size_t max, const char *text) {
  static const char hex[] = "0123456789ABCDEF";
  size_t n = 0;
  const unsigned char *p = (const unsigned char *)text;
  if (!out || !max) return 0;
  for (; p && *p; p++) {
    unsigned char c = *p;
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' ||
        c == '~') {
      if (n + 1 >= max) break;
      out[n++] = (char)c;
    } else {
      if (n + 3 >= max) break;
      out[n++] = '%';
      out[n++] = hex[c >> 4];
      out[n++] = hex[c & 15];
    }
  }
  out[n] = 0;
  return n;
}

/* Keep the optional wait callback referenced. */
void aurora_preview_net_tick(uint32_t ms) {
  if (g_net_wait) g_net_wait(ms);
}
