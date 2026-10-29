'use strict';

/*
 * Project templates. Each template is a small, working app so a new project
 * can be built and run immediately.
 *
 * `files` maps a path inside the project to its initial text. The first file
 * in `order` is the entry point unless `entry` says otherwise.
 */

const C_HELLO = `// {{NAME}} - an AuroraOS app in C.
//
// Build:  use the Build button in Aurora3DS Studio, or
//         python <SDK>/sdk/aurcc.py build src -o dist/{{SLUG}}.bin --icon icon.icon
// Run:    use the Run button to open the PC emulator.
#include <aurora_app.h>

int main(void) {
  int x = 200;

  while (app_loop()) {
    uint32_t held = hid_keys_held();
    if (held & KEY_LEFT) x -= 3;
    if (held & KEY_RIGHT) x += 3;
    if (x < 18) x = 18;
    if (x > SCREEN_TOP_WIDTH - 18) x = SCREEN_TOP_WIDTH - 18;

    gfx_clear(SCREEN_TOP, RGB(12, 15, 26));
    gfx_print(SCREEN_TOP, 16, 16, FONT_TITLE, COLOR_AURORA, "{{NAME}}");
    gfx_print(SCREEN_TOP, 16, 48, FONT_REGULAR, COLOR_GRAY,
              "Hello from the AuroraOS C SDK.");
    gfx_circle(SCREEN_TOP, x, 150, 16, COLOR_AURORA);
    gfx_print(SCREEN_TOP, 16, 196, FONT_SMALL, COLOR_WHITE,
              "Left / Right move the ball. START quits.");

    gfx_clear(SCREEN_BOTTOM, RGB(24, 26, 36));
    gfx_print(SCREEN_BOTTOM, 12, 12, FONT_BOLD, COLOR_WHITE, "C SDK");
    gfx_print(SCREEN_BOTTOM, 12, 38, FONT_SMALL, COLOR_GRAY,
              "This app is made of C source files.\\n"
              "Add more .c files in the Files panel;\\n"
              "they are all compiled together.");

    if (hid_keys_down() & KEY_START)
      break;
  }
  return 0;
}
`;

const C_GAME_MAIN = `// {{NAME}} - a small game split over several C files.
#include <aurora_app.h>
#include "game.h"

int main(void) {
  game_init();

  while (app_loop()) {
    game_update();
    game_draw();

    if (hid_keys_down() & KEY_START)
      break;
  }
  return 0;
}
`;

const C_GAME_H = `// game.h - shared declarations for the game modules.
#ifndef {{SLUG_UPPER}}_GAME_H
#define {{SLUG_UPPER}}_GAME_H

void game_init(void);
void game_update(void);
void game_draw(void);

#endif
`;

const C_GAME_C = `// game.c - the game state and drawing. This is a second C file in the
// project; the SDK compiles every .c file it is given and links them together.
#include <aurora_app.h>
#include "game.h"

#define BALL_R 12

static int ball_x;
static int ball_y;
static int vel_x;
static int vel_y;
static int score;

void game_init(void) {
  ball_x = 120;
  ball_y = 120;
  vel_x = 3;
  vel_y = 2;
  score = 0;
}

void game_update(void) {
  uint32_t held = hid_keys_held();
  if (held & KEY_LEFT)  ball_x -= 2;
  if (held & KEY_RIGHT) ball_x += 2;
  if (held & KEY_UP)    ball_y -= 2;
  if (held & KEY_DOWN)  ball_y += 2;

  ball_x += vel_x;
  ball_y += vel_y;
  if (ball_x < BALL_R) { ball_x = BALL_R; vel_x = -vel_x; score++; }
  if (ball_x > SCREEN_TOP_WIDTH - BALL_R) {
    ball_x = SCREEN_TOP_WIDTH - BALL_R;
    vel_x = -vel_x;
    score++;
  }
  if (ball_y < BALL_R + 30) { ball_y = BALL_R + 30; vel_y = -vel_y; score++; }
  if (ball_y > SCREEN_HEIGHT - BALL_R) {
    ball_y = SCREEN_HEIGHT - BALL_R;
    vel_y = -vel_y;
    score++;
  }
}

void game_draw(void) {
  gfx_clear(SCREEN_TOP, RGB(10, 12, 22));
  gfx_print(SCREEN_TOP, 12, 8, FONT_TITLE, COLOR_AURORA, "{{NAME}}");
  gfx_print(SCREEN_TOP, 300, 12, FONT_REGULAR, COLOR_WHITE, "Score %d", score);
  gfx_circle(SCREEN_TOP, ball_x, ball_y, BALL_R, COLOR_ORANGE);

  gfx_clear(SCREEN_BOTTOM, RGB(24, 26, 36));
  gfx_print(SCREEN_BOTTOM, 12, 12, FONT_BOLD, COLOR_WHITE, "Multi-file C app");
  gfx_print(SCREEN_BOTTOM, 12, 40, FONT_SMALL, COLOR_GRAY,
            "main.c starts the app.\\n"
            "game.c holds the game.\\n"
            "game.h is shared by both.");
  gfx_print(SCREEN_BOTTOM, 12, 190, FONT_SMALL, COLOR_AURORA,
            "D-pad nudges the ball. START quits.");
}
`;

const C_BLANK = `// {{NAME}} - a blank AuroraOS app in C.
#include <aurora_app.h>

int main(void) {
  while (app_loop()) {
    gfx_clear(SCREEN_TOP, COLOR_BLACK);
    gfx_print(SCREEN_TOP, 16, 16, FONT_REGULAR, COLOR_WHITE, "{{NAME}}");
    if (hid_keys_down() & KEY_START)
      break;
  }
  return 0;
}
`;

const AURIC_HELLO = `// {{NAME}} - an AuroraOS app in Auric.
// Build with the Build button, or:
//   python <SDK>/auric-lang/compiler/aurc.py build src/main.aur \\
//       -o dist/{{SLUG}}.bin --icon icon.icon
fn main() {
    clear(BLACK);
    print("{{NAME}}", 40, 92, AURORA);
    print("Hello from Auric!", 40, 116, WHITE);
    print("Press A to exit.", 40, 148, GRAY);
    wait_key(KEY_A);
}
`;

const AURIC_GAME_MAIN = `// {{NAME}} - the entry point of a multi-file Auric game.
// All .aur files in the project are joined in the order shown in the Files
// panel, then compiled as one program.
fn main() {
    buffered(true);
    game_init();

    let next_step = millis() + 500;
    let running = true;

    while running {
        let now = millis();
        if now >= next_step {
            next_step = now + 500;
            game_step();
        }

        game_draw();
        present();

        if (keys_down() & KEY_START) != 0 {
            running = false;
        }
    }
}
`;

const AURIC_GAME = `// game.aur - the game state. main.aur calls these functions.
let ball_x = 160;
let ball_y = 120;
let vel_x = 4;
let vel_y = 3;
let score = 0;

fn game_init() {
    ball_x = 160;
    ball_y = 120;
    vel_x = 4;
    vel_y = 3;
    score = 0;
}

fn game_step() {
    ball_x = ball_x + vel_x;
    ball_y = ball_y + vel_y;

    if ball_x < 14 {
        ball_x = 14;
        vel_x = -vel_x;
        score = score + 1;
    }
    if ball_x > 386 {
        ball_x = 386;
        vel_x = -vel_x;
        score = score + 1;
    }
    if ball_y < 44 {
        ball_y = 44;
        vel_y = -vel_y;
        score = score + 1;
    }
    if ball_y > 226 {
        ball_y = 226;
        vel_y = -vel_y;
        score = score + 1;
    }
}

fn game_draw() {
    screen(TOP);
    clear(0x0A0C16);
    print("{{NAME}}", 12, 8, AURORA);
    print_int(score, 350, 10, WHITE);
    fill_rect(ball_x - 12, ball_y - 12, 24, 24, ORANGE);

    screen(BOTTOM);
    clear(0x181A24);
    print("Multi-file Auric app", 12, 12, WHITE);
    print("game.aur holds the game.", 12, 40, GRAY);
    print("main.aur starts the app.", 12, 56, GRAY);
    print("START quits.", 12, 196, AURORA);
}
`;

const AURIC_PAINT = `// {{NAME}} - paint with the stylus on the bottom screen.
fn main() {
    buffered(true);

    screen(BOTTOM);
    clear(WHITE);

    let last_x = -1;
    let last_y = -1;
    let ink = AURORA;

    while true {
        if (keys_down() & KEY_A) != 0 {
            ink = RED;
        }
        if (keys_down() & KEY_B) != 0 {
            ink = AURORA;
        }
        if (keys_down() & KEY_X) != 0 {
            screen(BOTTOM);
            clear(WHITE);
        }
        if (keys_down() & KEY_START) != 0 {
            return;
        }

        if touch_held() {
            let x = touch_x();
            let y = touch_y();
            screen(BOTTOM);
            if last_x >= 0 {
                let dx = x - last_x;
                let dy = y - last_y;
                let steps = 1;
                if dx < 0 { dx = -dx; }
                if dy < 0 { dy = -dy; }
                if dx > steps { steps = dx; }
                if dy > steps { steps = dy; }
                let i = 0;
                while i <= steps {
                    fill_rect(last_x + (x - last_x) * i / steps,
                              last_y + (y - last_y) * i / steps,
                              4, 4, ink);
                    i = i + 1;
                }
            } else {
                fill_rect(x - 2, y - 2, 4, 4, ink);
            }
            last_x = x;
            last_y = y;
        } else {
            last_x = -1;
            last_y = -1;
        }

        screen(TOP);
        clear(0x0C0E18);
        print("{{NAME}}", 16, 16, AURORA);
        print("Draw on the bottom screen.", 16, 48, WHITE);
        print("A: red   B: aurora   X: clear   START: quit", 16, 80, GRAY);

        present();
    }
}
`;

const AURIC_BLANK = `// {{NAME}} - a blank AuroraOS app in Auric.
fn main() {
    clear(BLACK);
    print("{{NAME}}", 16, 16, WHITE);
    wait_key(KEY_A);
}
`;

const TEMPLATES = [
  {
    id: 'c-hello',
    name: 'C: Hello window',
    language: 'c',
    description: 'A friendly starter with both screens, a moving ball and input.',
    entry: 'src/main.c',
    files: { 'src/main.c': C_HELLO },
    order: ['src/main.c']
  },
  {
    id: 'c-game',
    name: 'C: Multi-file game',
    language: 'c',
    description: 'main.c, game.c and game.h: the smallest useful multi-file project.',
    entry: 'src/main.c',
    files: {
      'src/main.c': C_GAME_MAIN,
      'src/game.c': C_GAME_C,
      'src/game.h': C_GAME_H
    },
    order: ['src/main.c', 'src/game.c', 'src/game.h']
  },
  {
    id: 'c-blank',
    name: 'C: Blank',
    language: 'c',
    description: 'Just a main() and a frame loop.',
    entry: 'src/main.c',
    files: { 'src/main.c': C_BLANK },
    order: ['src/main.c']
  },
  {
    id: 'auric-hello',
    name: 'Auric: Hello',
    language: 'auric',
    description: 'The smallest Auric app: draw text, wait for a button.',
    entry: 'src/main.aur',
    files: { 'src/main.aur': AURIC_HELLO },
    order: ['src/main.aur']
  },
  {
    id: 'auric-game',
    name: 'Auric: Multi-file game',
    language: 'auric',
    description: 'main.aur and game.aur joined into one program by the studio.',
    entry: 'src/main.aur',
    files: {
      'src/game.aur': AURIC_GAME,
      'src/main.aur': AURIC_GAME_MAIN
    },
    order: ['src/game.aur', 'src/main.aur']
  },
  {
    id: 'auric-paint',
    name: 'Auric: Paint',
    language: 'auric',
    description: 'A touch drawing app for the bottom screen.',
    entry: 'src/main.aur',
    files: { 'src/main.aur': AURIC_PAINT },
    order: ['src/main.aur']
  },
  {
    id: 'auric-blank',
    name: 'Auric: Blank',
    language: 'auric',
    description: 'An empty Auric program.',
    entry: 'src/main.aur',
    files: { 'src/main.aur': AURIC_BLANK },
    order: ['src/main.aur']
  }
];

function applyPlaceholders(text, name, slug) {
  const upper = String(slug || 'APP').replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return String(text)
    .replaceAll('{{NAME}}', name)
    .replaceAll('{{SLUG}}', slug)
    .replaceAll('{{SLUG_UPPER}}', upper);
}

function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

function templatesFor(language) {
  return TEMPLATES.filter((t) => t.language === language);
}

module.exports = {
  TEMPLATES,
  getTemplate,
  templatesFor,
  applyPlaceholders
};
