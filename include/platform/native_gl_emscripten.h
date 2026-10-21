#ifndef NATIVE_GL_EMSCRIPTEN_H
#define NATIVE_GL_EMSCRIPTEN_H

// Emscripten stand-in for native_glad.h : WebGL2 is linked statically through
// Emscripten's GLES3 headers, so there is no loader to run. The desktop-only
// GL paths (polygon mode, KHR_debug groups, timer queries, BGRA readback) are
// compiled out at their call sites under __EMSCRIPTEN__.

#include <GLES3/gl3.h>

static inline int gladLoadGL(void)
{
	return 1;
}

#endif
