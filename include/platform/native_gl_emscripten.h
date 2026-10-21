#ifndef NATIVE_GL_EMSCRIPTEN_H
#define NATIVE_GL_EMSCRIPTEN_H

// Emscripten stand-in for native_glad.h : WebGL2 is linked statically through
// Emscripten's GLES3 headers, so there is no loader to run.
//
// The desktop-only names below exist so the renderer compiles unchanged. They
// are not a port : they do nothing (or raise a harmless GL_INVALID_ENUM) until
// the WebGL2 renderer replaces their call sites.

#include <GLES3/gl3.h>

static inline int gladLoadGL(void)
{
	return 1;
}

// KHR_debug is not exposed by WebGL2 : debug groups stay off.
#define GLAD_GL_KHR_debug 0
#define GL_DEBUG_SOURCE_APPLICATION 0x824A
static inline void glPushDebugGroup(GLenum source, GLuint id, GLsizei length, const char *message)
{
	(void)source; (void)id; (void)length; (void)message;
}
static inline void glPopDebugGroup(void)
{
}

// Wireframe debug view : no polygon mode in WebGL2.
#define GL_LINE 0x1B01
#define GL_FILL 0x1B02
static inline void glPolygonMode(GLenum face, GLenum mode)
{
	(void)face; (void)mode;
}

// Screenshot readback (CTR_INTERNAL) : WebGL2 reads RGBA only.
#define GL_BGRA 0x80E1

// GPU timer queries (CTR_INTERNAL) : ES 3.0 has only the unsigned getter.
static inline void glGetQueryObjectiv(GLuint id, GLenum pname, GLint *params)
{
	GLuint value = 0;
	glGetQueryObjectuiv(id, pname, &value);
	*params = (GLint)value;
}

#endif
