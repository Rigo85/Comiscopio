#include "mupdf_renderer.h"

#include <mupdf/fitz.h>

#include <algorithm>
#include <cstring>

MuPdfRenderer::~MuPdfRenderer() {
    close();
}

bool MuPdfRenderer::open(const std::string& path) {
    close();

    ctx = fz_new_context(nullptr, nullptr, FZ_STORE_DEFAULT);
    if (!ctx) return false;

    fz_register_document_handlers(ctx);

    fz_try(ctx) {
        doc = fz_open_document(ctx, path.c_str());
        pages = fz_count_pages(ctx, doc);
    }
    fz_catch(ctx) {
        close();
        return false;
    }

    return true;
}

int MuPdfRenderer::pageCount() const {
    return pages;
}

DocPageInfo MuPdfRenderer::pageDimensions(int pageIndex) const {
    DocPageInfo info{0, 0};
    if (!ctx || !doc || pageIndex < 0 || pageIndex >= pages) return info;

    fz_page* page = nullptr;
    fz_try(ctx) {
        page = fz_load_page(ctx, doc, pageIndex);
        fz_rect bounds = fz_bound_page(ctx, page);
        info.width = bounds.x1 - bounds.x0;
        info.height = bounds.y1 - bounds.y0;
    }
    fz_catch(ctx) {
        // Leave as 0,0
    }
    if (page) fz_drop_page(ctx, page);
    return info;
}

bool MuPdfRenderer::renderPage(int pageIndex, int maxDim,
                                std::vector<uint8_t>& outRgb,
                                int& outWidth, int& outHeight) {
    if (!ctx || !doc || pageIndex < 0 || pageIndex >= pages) return false;

    fz_page* page = nullptr;
    fz_pixmap* pix = nullptr;
    bool ok = false;

    fz_try(ctx) {
        page = fz_load_page(ctx, doc, pageIndex);
        fz_rect bounds = fz_bound_page(ctx, page);
        float pageW = bounds.x1 - bounds.x0;
        float pageH = bounds.y1 - bounds.y0;

        if (pageW <= 0 || pageH <= 0) {
            fz_throw(ctx, FZ_ERROR_GENERIC, "invalid page dimensions");
        }

        // Calculate scale so the largest side fits maxDim
        float maxSide = std::max(pageW, pageH);
        float scale = static_cast<float>(maxDim) / maxSide;
        // Don't upscale small pages
        if (scale > 1.0f) scale = 1.0f;

        fz_matrix matrix = fz_scale(scale, scale);
        fz_colorspace* cs = fz_device_rgb(ctx);

        pix = fz_new_pixmap_from_page(ctx, page, matrix, cs, 0);

        outWidth = fz_pixmap_width(ctx, pix);
        outHeight = fz_pixmap_height(ctx, pix);
        int stride = fz_pixmap_stride(ctx, pix);
        int n = fz_pixmap_components(ctx, pix);
        unsigned char* samples = fz_pixmap_samples(ctx, pix);

        // Copy to output buffer as packed RGB (3 bytes/pixel)
        outRgb.resize(outWidth * outHeight * 3);
        if (n == 3 && stride == outWidth * 3) {
            // Already RGB, direct copy
            std::memcpy(outRgb.data(), samples, outRgb.size());
        } else {
            // Convert from whatever format MuPDF gave us (could be RGBA or different stride)
            for (int y = 0; y < outHeight; y++) {
                const unsigned char* src = samples + y * stride;
                unsigned char* dst = outRgb.data() + y * outWidth * 3;
                for (int x = 0; x < outWidth; x++) {
                    dst[x * 3 + 0] = src[x * n + 0];
                    dst[x * 3 + 1] = src[x * n + 1];
                    dst[x * 3 + 2] = src[x * n + 2];
                }
            }
        }

        ok = true;
    }
    fz_catch(ctx) {
        ok = false;
    }

    if (pix) fz_drop_pixmap(ctx, pix);
    if (page) fz_drop_page(ctx, page);
    return ok;
}

void MuPdfRenderer::close() {
    if (doc && ctx) fz_drop_document(ctx, doc);
    doc = nullptr;
    pages = 0;
    if (ctx) fz_drop_context(ctx);
    ctx = nullptr;
}
