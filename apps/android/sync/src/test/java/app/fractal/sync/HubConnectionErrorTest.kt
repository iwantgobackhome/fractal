package app.fractal.sync

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.testng.Assert.assertFalse
import org.testng.Assert.assertTrue
import org.testng.annotations.Test

class HubConnectionErrorTest {
    @Test fun recognizesConnectionErrorsAndWrappedCauses() {
        for (failure in listOf(ConnectException(), SocketTimeoutException(), UnknownHostException())) {
            assertTrue(isHubConnectionError(failure))
            assertTrue(isHubConnectionError(IOException("Request failed", failure)))
        }
    }
    @Test fun preservesHttpAndOtherFailures() {
        assertFalse(isHubConnectionError(HubHttpException(401, "Pair again")))
        assertFalse(isHubConnectionError(IOException("Empty hub response")))
        assertFalse(isHubConnectionError(IllegalArgumentException("Invalid URL")))
    }
}
