package app.fractal.reader.update

import android.widget.Toast
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import app.fractal.reader.R

internal val LocalUpdates = staticCompositionLocalOf<UpdateViewModel?> { null }

@Composable
internal fun UpdateDialogs(updates: UpdateViewModel, install: () -> Unit) {
    val status by updates.status.collectAsState()
    val context = LocalContext.current
    LaunchedEffect(status.message) {
        status.message?.let { message ->
            Toast.makeText(context, context.getString(when (message) {
                UpdateMessage.Error -> R.string.update_error
                UpdateMessage.Current -> R.string.update_current
                UpdateMessage.InstallPermission -> R.string.update_permission
            }), Toast.LENGTH_LONG).show()
            updates.clearMessage()
        }
    }
    LaunchedEffect(status.ready) { if (status.ready) install() }
    when {
        status.progress != null -> AlertDialog(
            onDismissRequest = {},
            title = { Text(stringResource(R.string.update_downloading)) },
            text = { Column {
                LinearProgressIndicator(progress = { (status.progress ?: 0) / 100f })
                Text(stringResource(R.string.update_progress, status.progress ?: 0))
            } },
            confirmButton = {},
        )
        status.ready -> AlertDialog(
            onDismissRequest = {},
            title = { Text(stringResource(R.string.update_ready)) },
            confirmButton = { TextButton(onClick = install) { Text(stringResource(R.string.update_install)) } },
        )
        status.release != null -> AlertDialog(
            onDismissRequest = updates::later,
            title = { Text(stringResource(R.string.update_available, status.release!!.version)) },
            confirmButton = { TextButton(onClick = updates::download) { Text(stringResource(R.string.update_action)) } },
            dismissButton = { TextButton(onClick = updates::later) { Text(stringResource(R.string.update_later)) } },
        )
    }
}
