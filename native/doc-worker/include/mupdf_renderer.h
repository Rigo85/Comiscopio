#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct fz_context;
struct fz_document;

struct DocPageInfo {
    float width;   // points (1 point = 1/72 inch)
    float height;
};

/**
 * Renders document pages (PDF, DjVu, EPUB, XPS) to RGB pixel buffers
 * using MuPDF's fitz engine.
 */
class MuPdfRenderer {
public:
    MuPdfRenderer() = default;
    ~MuPdfRenderer();

    /// Open a document. Returns true on success.
    bool open(const std::string& path);

    /// Number of pages in the document.
    int pageCount() const;

    /// Get page dimensions in points (without rendering).
    DocPageInfo pageDimensions(int pageIndex) const;

    /**
     * Render a page to an RGB pixel buffer.
     *
     * @param pageIndex   0-based page index
     * @param maxDim      Maximum dimension (width or height) in pixels
     * @param outRgb      Output RGB buffer (3 bytes per pixel, row-major)
     * @param outWidth    Output pixel width
     * @param outHeight   Output pixel height
     * @return            true on success
     */
    bool renderPage(int pageIndex, int maxDim,
                    std::vector<uint8_t>& outRgb,
                    int& outWidth, int& outHeight);

    /// Close document and free resources.
    void close();

private:
    fz_context* ctx = nullptr;
    fz_document* doc = nullptr;
    int pages = 0;
};
