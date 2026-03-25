#pragma once

#include <string>

/// Emit a progress event for a processing stage
void emitProgress(int pageIndex, int total, const std::string& stage, const std::string& file);

/// Emit an error event for a page
void emitError(int pageIndex, const std::string& message);

/// Emit the final done event
void emitDone(int total, double elapsedMs);
