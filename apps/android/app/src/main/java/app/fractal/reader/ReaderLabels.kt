package app.fractal.reader

import androidx.compose.runtime.Composable

@Composable internal fun readerKindLabel(kind: String) = when (kind) {
    "explanation" -> libraryText("Explanation", "설명")
    "cancel" -> libraryText("Cancel answer", "답변 취소")
    "delete" -> libraryText("Delete history", "기록 삭제")
    "conversation" -> libraryText("Conversation", "대화")
    else -> libraryText("Question", "질문")
}
@Composable internal fun readerStateLabel(status: String) = when (status) {
    "queued" -> libraryText("Waiting to send", "전송 대기")
    "sending" -> libraryText("Sending", "전송 중")
    "pending" -> libraryText("Waiting for answer", "답변 대기")
    "running" -> libraryText("Answering", "답변 생성 중")
    "failed" -> libraryText("Failed · context retained", "실패 · 문맥 보존됨")
    "canceled" -> libraryText("Canceled", "취소됨")
    else -> libraryText("Completed", "완료")
}
@Composable internal fun readerQuoteLabel(origin: String) = if (origin == "translated") libraryText("Translated quote", "번역문 인용") else libraryText("Original quote", "원문 인용")
@Composable internal fun readerExcerptLabel(kind: String) = when (kind) {
    "figure" -> libraryText("Figure", "그림")
    "equation" -> libraryText("Equation", "수식")
    "table" -> libraryText("Table", "표")
    else -> libraryText("Selected passage", "선택한 내용")
}
@Composable internal fun readerSourceLabel(status: String) = when (status) {
    "pdf_changed", "layout_changed", "range_invalid" -> libraryText("Source changed. Select the passage again.", "원문이 변경되었습니다. 내용을 다시 선택하세요.")
    "unavailable" -> libraryText("Source is unavailable; retained quote is shown.", "원문을 사용할 수 없어 저장된 인용문을 표시합니다.")
    else -> libraryText("Retained context", "저장된 문맥")
}
