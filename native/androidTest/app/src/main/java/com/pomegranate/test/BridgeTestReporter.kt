package com.pomegranate.test

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.util.logging.Logger

/**
 * Native module that receives test results from the JS test runner.
 * The instrumentation test (PomegranateInstrumentedTest) waits on
 * [testFinishedNotification] and reads [result] to determine pass/fail.
 */
class BridgeTestReporter(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    sealed class Result {
        class Success(
            val messages: List<String>,
        ) : Result()

        class Failure(
            val errors: List<String>,
        ) : Result()
    }

    override fun getName() = "BridgeTestReporter"

    companion object {
        lateinit var result: Result
        val testFinishedNotification = Object()
    }

    @Suppress("UNCHECKED_CAST")
    @ReactMethod
    fun testsFinished(report: ReadableMap) {
        Logger.getLogger(name).info(report.toString())

        val errorCount = report.getInt("errorCount")
        val rawResults = report.toHashMap()["results"] as? ArrayList<HashMap<String, Any>> ?: arrayListOf()

        result =
            if (errorCount > 0) {
                val errors =
                    rawResults
                        .filter { !(it["passed"] as? Boolean ?: true) }
                        .map { it["message"] as? String ?: "Unknown error" }
                Result.Failure(errors)
            } else {
                val messages =
                    rawResults
                        .filter { it["passed"] as? Boolean ?: false }
                        .map { it["message"] as? String ?: "" }
                Result.Success(messages)
            }

        synchronized(testFinishedNotification) {
            testFinishedNotification.notify()
        }
    }
}
