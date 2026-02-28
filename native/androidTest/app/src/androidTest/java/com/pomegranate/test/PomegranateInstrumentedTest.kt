package com.pomegranate.test

import android.util.Log
import androidx.test.core.app.launchActivity
import org.junit.Assert
import org.junit.Test

/**
 * Android instrumentation test that launches the React Native app,
 * waits for JS integration tests to complete, and reports results
 * back to the Gradle test runner.
 */
class PomegranateInstrumentedTest {
    @Test
    fun runIntegrationTests() {
        // Launch the RN activity — this starts the JS runtime and runs tests
        launchActivity<MainActivity>()

        // Wait for JS tests to finish (5 minute timeout)
        synchronized(BridgeTestReporter.testFinishedNotification) {
            BridgeTestReporter.testFinishedNotification.wait(5 * 60 * 1000)
        }

        try {
            when (val result = BridgeTestReporter.result) {
                is BridgeTestReporter.Result.Success -> {
                    result.messages
                        .filter { it.isNotEmpty() }
                        .forEach { Log.d("PomegranateTest", it) }
                    Log.d("PomegranateTest", "All integration tests passed")
                }
                is BridgeTestReporter.Result.Failure -> {
                    val failureString =
                        result.errors
                            .filter { it.isNotEmpty() }
                            .joinToString(separator = "\n")
                    Assert.fail(failureString)
                }
            }
        } catch (e: UninitializedPropertyAccessException) {
            Assert.fail(
                "Integration tests timed out (5 min). " +
                    "Either JS could not be loaded or an async test never completed.",
            )
        }
    }
}
