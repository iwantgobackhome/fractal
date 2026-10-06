package app.fractal.reader

import android.content.Intent
import android.net.Uri
import android.annotation.SuppressLint
import android.widget.Toast
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import app.fractal.design.LocalFractalColors
import app.fractal.sync.PairingPayloadParser
import app.fractal.sync.NoPairingUrlsException
import app.fractal.sync.SyncScheduler
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.launch

@Composable
fun ConnectScreen(
    app: ReaderApplication,
    cameraGranted: Boolean,
    requestCamera: () -> Unit,
    onConnected: () -> Unit,
    onBrowseCached: (() -> Unit)? = null,
) {
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    var scanning by remember { mutableStateOf(false) }
    var manual by remember { mutableStateOf(false) }
    var url by remember { mutableStateOf("http://10.0.2.2:7410") }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    suspend fun connected() {
        runCatching { app.sync.syncOnce() }.onSuccess {
            app.sync.lastWarning?.let {
                Toast.makeText(app, app.getString(R.string.sync_large_item_pending), Toast.LENGTH_LONG).show()
            }
        }.onFailure {
            Toast.makeText(app, app.getString(R.string.connected_sync_failed, it.message.orEmpty()), Toast.LENGTH_LONG).show()
            SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
        }
        onConnected()
    }

    fun pairingError(failure: Throwable): String = when {
        failure is NoPairingUrlsException -> app.getString(R.string.pairing_enable_network)
        generateSequence(failure) { it.cause }.any { it is java.io.IOException && it !is app.fractal.sync.HubHttpException } ->
            app.getString(R.string.pairing_network_hint)
        else -> failure.message ?: app.getString(R.string.connection_failed)
    }

    fun openTailscale() {
        val launch = app.packageManager.getLaunchIntentForPackage("com.tailscale.ipn")
        val store = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.tailscale.ipn"))
        runCatching { app.startActivity((launch ?: store).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure {
            app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    fun pairQr(raw: String) {
        if (busy) return
        busy = true
        scanning = false
        scope.launch {
            runCatching {
                app.client.pair(PairingPayloadParser.parse(raw), android.os.Build.MODEL)
            }.onSuccess {
                connected()
            }.onFailure {
                error = pairingError(it)
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text(stringResource(R.string.app_name), fontFamily = FontFamily.Serif, fontSize = 38.sp, color = colors.ink)
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.connect_subtitle), color = colors.inkSoft)
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.pairing_steps), color = colors.inkSoft)
        TextButton(onClick = ::openTailscale) { Text(stringResource(R.string.pairing_open_tailscale)) }
        Spacer(Modifier.height(12.dp))
        if (scanning && cameraGranted) {
            QrCamera(onFound = ::pairQr, modifier = Modifier.fillMaxWidth().height(300.dp))
        }
        if (manual) {
            OutlinedTextField(url, { url = it }, label = { Text(stringResource(R.string.hub_address)) }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            OutlinedTextField(code, { code = it }, label = { Text(stringResource(R.string.connection_code)) }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            Button(enabled = !busy && code.isNotBlank(), onClick = {
                busy = true
                scope.launch {
                    runCatching {
                        app.client.claim(url, code, deviceName = android.os.Build.MODEL)
                    }.onSuccess { connected() }.onFailure {
                        error = pairingError(it)
                        busy = false
                    }
                }
            }) { Text(stringResource(R.string.connect)) }
        } else {
            Button(onClick = {
                if (cameraGranted) scanning = true else requestCamera()
            }) { Text(stringResource(R.string.scan_qr)) }
            TextButton(onClick = {
                manual = true
                scanning = false
            }) { Text(stringResource(R.string.enter_address_code)) }
        }
        onBrowseCached?.let { TextButton(onClick = it) { Text(stringResource(R.string.saved_offline)) } }
        if (error.isNotEmpty()) Text(error, color = colors.accent)
    }
}

@SuppressLint("UnsafeOptInUsageError")
@Composable
private fun QrCamera(onFound: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        )
    }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    DisposableEffect(owner) {
        onDispose {
            provider?.unbindAll()
            scanner.close()
        }
    }
    AndroidView(factory = { PreviewView(it) }, modifier = modifier) { view ->
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val cameraProvider = future.get()
            provider = cameraProvider
            val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(ContextCompat.getMainExecutor(context)) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage == null) {
                    imageProxy.close()
                } else {
                    val input = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                    scanner.process(input).addOnSuccessListener { results ->
                        results.firstOrNull()?.rawValue?.let(onFound)
                    }.addOnCompleteListener { imageProxy.close() }
                }
            }
            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(context))
    }
}
