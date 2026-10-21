#ifndef NATIVE_WEB_UI_H
#define NATIVE_WEB_UI_H

// The browser page's « Skip intro » setting (web/ui/, Settings › Player ; on by default).
// NativeWeb_IntroSkip() returns 1 once per recent press — any key but the debug F-keys, any pad
// button — while the setting is on, and the intro screens that test it end at once : SCEA
// (game/MAIN/MainMain.c), the copyright wait (game/LOAD/LOAD_TenStages.c), the Naughty Dog crate
// (game/233/CS_Thread.c), the title / trophy animation (game/230/MM_Title.c). The disc loads
// between them are not shortened. Defined in platform/native_input.c ; the page is pulled, it
// never calls in (ASYNCIFY). Native builds : always 0, the original intro.
#if defined(__EMSCRIPTEN__)
#include <emscripten/em_macros.h>
// declared as the EM_JS import it is : the game's files see this before the EM_JS (unity build)
int NativeWeb_IntroSkip(void) EM_IMPORT(NativeWeb_IntroSkip);
#else
#define NativeWeb_IntroSkip() 0
#endif

#endif
