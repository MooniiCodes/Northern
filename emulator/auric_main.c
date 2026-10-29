/* The Auric compiler emits `au_main`; the device start-up code calls it. On a
 * PC the C runtime needs a normal main(), so provide one. */
extern void au_main(void);

int main(void) {
  au_main();
  return 0;
}
