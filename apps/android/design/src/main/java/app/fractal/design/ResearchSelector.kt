package app.fractal.design

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.res.stringResource

/** Full labels, visible selection, bounded touch targets, and native focus traversal. */
@Composable
fun ResearchSelector(label: String, selected: String, options: List<Pair<String, String>>,
    onSelected: (String) -> Unit, modifier: Modifier = Modifier, emptyLabel: String? = null,
    enabled: Boolean = true, loading: Boolean = false) {
    val colors = LocalFractalColors.current
    var open by remember { mutableStateOf(false) }
    var focusedId by remember { mutableStateOf<String?>(selected) }
    fun currentFocus() = options.indexOfFirst { it.first == focusedId }.takeIf { it >= 0 }
        ?: options.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    val focused = currentFocus()
    val unavailable = emptyLabel ?: stringResource(R.string.selector_unavailable)
    val loadingLabel = stringResource(R.string.selector_loading)
    val closeLabel = stringResource(R.string.selector_close)
    val display = if (loading) loadingLabel
        else options.firstOrNull { it.first == selected }?.second ?: unavailable
    val canOpen = enabled && !loading && options.isNotEmpty()
    val focus = remember { FocusRequester() }
    val trigger = remember { FocusRequester() }
    var triggerFocused by remember { mutableStateOf(false) }
    var hadDialog by remember { mutableStateOf(false) }
    var closeFocused by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    fun dismiss() { open = false }
    fun moveTo(index: Int) { options.getOrNull(index)?.let { focusedId = it.first } }
    LaunchedEffect(open, canOpen) {
        if (open) hadDialog = true
        else if (hadDialog && canOpen) {
            withFrameNanos { }
            trigger.requestFocus()
            hadDialog = false
        }
    }
    LaunchedEffect(selected, options.map { it.first }) {
        if (!open) focusedId = selected
        else if (options.none { it.first == focusedId }) focusedId = options.firstOrNull { it.first == selected }?.first ?: options.firstOrNull()?.first
    }
    Column(modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = colors.inkSoft)
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).focusRequester(trigger).onFocusChanged { triggerFocused = it.isFocused }
            .border(if (triggerFocused) 2.dp else .5.dp, if (triggerFocused) colors.focus else colors.rule)
            .semantics { role = Role.DropdownList; stateDescription = display }
            .clickable(enabled = canOpen) { trigger.requestFocus(); closeFocused = false; focusedId = selected; open = true }.padding(12.dp)) {
            Text(display,
                Modifier.weight(1f), color = colors.ink)
            Text("⌄", color = colors.inkSoft)
        }
    }
    if (open) Dialog(onDismissRequest = ::dismiss) {
        Surface(color = colors.paper, modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
            Column(Modifier.padding(16.dp).focusRequester(focus).onPreviewKeyEvent {
                if (it.type != KeyEventType.KeyDown) false
                else if (it.key == Key.Escape) { dismiss(); true }
                else if (closeFocused) false
                else when (it.key) {
                    Key.DirectionDown -> { moveTo((currentFocus() + 1).coerceAtMost(options.lastIndex)); true }
                    Key.DirectionUp -> { moveTo((currentFocus() - 1).coerceAtLeast(0)); true }
                    Key.MoveHome -> { moveTo(0); true }
                    Key.MoveEnd -> { moveTo(options.lastIndex); true }
                    Key.Enter, Key.NumPadEnter -> {
                        if (enabled && !loading) options.getOrNull(currentFocus())?.let { onSelected(it.first); dismiss() }
                        true
                    }
                    else -> false
                }
            }.focusable()) {
                Text(label, style = MaterialTheme.typography.titleLarge)
                if (options.isEmpty() || loading) Text(if (loading) loadingLabel else unavailable,
                    Modifier.padding(vertical = 16.dp).semantics { liveRegion = LiveRegionMode.Polite }, color = colors.inkSoft)
                LazyColumn(Modifier.weight(1f, fill = false), state = list) {
                    itemsIndexed(options) { index, option ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .onFocusChanged { if (it.isFocused) focusedId = option.first }
                            .border(if (index == focused) 2.dp else 0.dp, if (index == focused) colors.focus else colors.paper)
                            .semantics { role = Role.RadioButton; this.selected = option.first == selected }
                            .clickable(enabled = enabled && !loading) { onSelected(option.first); dismiss() }.padding(vertical = 12.dp, horizontal = 8.dp)) {
                            Text(if (option.first == selected) "✓ " else "  ", color = colors.accent)
                            Text(option.second, color = colors.ink)
                        }
                    }
                }
                TextButton(onClick = ::dismiss, modifier = Modifier.onFocusChanged { closeFocused = it.isFocused }) { Text(closeLabel) }
            }
        }
        LaunchedEffect(Unit) { focus.requestFocus() }
        LaunchedEffect(focusedId, options.size) { if (options.isNotEmpty()) list.scrollToItem(focused.coerceIn(0, options.lastIndex)) }
    }
}
