package app.fractal.pdf

import android.graphics.Point
import android.graphics.pdf.PdfRenderer
import android.graphics.pdf.models.selection.SelectionBoundary

/** Isolated native types cannot be resolved by the cached reader on API29–34. */
@android.annotation.TargetApi(35)
internal object NativePageSelection {
    fun select(page: PdfRenderer.Page, x: Float, y: Float, endX: Float, endY: Float): PdfTextSelection? {
        fun boundary(px: Float, py: Float) = SelectionBoundary(Point((px.coerceIn(0f, 1f) * page.width).toInt(), (py.coerceIn(0f, 1f) * page.height).toInt()))
        val selected = page.selectContent(boundary(x, y), boundary(endX, endY)) ?: return null
        val contents = selected.selectedTextContents
        val rects = contents.flatMap { it.bounds }.map { rect -> PdfRect((rect.left / page.width).coerceIn(0f, 1f), (rect.top / page.height).coerceIn(0f, 1f), (rect.width() / page.width).coerceIn(0f, 1f), (rect.height() / page.height).coerceIn(0f, 1f)) }
        return PdfTextSelection(contents.joinToString(" ") { it.text }, rects)
    }
}
