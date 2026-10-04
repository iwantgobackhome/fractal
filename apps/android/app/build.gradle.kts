plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.fractal.reader"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.fractal.reader"
        minSdk = 29
        targetSdk = 35
        versionCode = 4
        versionName = "0.2.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    val ciDebugKeystorePath = providers.environmentVariable("FRACTAL_ANDROID_KEYSTORE_PATH").orNull
    if (System.getenv("GITHUB_ACTIONS") == "true") {
        require(!ciDebugKeystorePath.isNullOrBlank()) { "CI must provide the verified debug signing store path" }
    }
    if (!ciDebugKeystorePath.isNullOrBlank()) {
        val ciDebugKeystore = file(ciDebugKeystorePath)
        require(ciDebugKeystore.isAbsolute && ciDebugKeystore.isFile) { "Verified CI debug signing store is missing" }
        signingConfigs.getByName("debug") {
            storeFile = ciDebugKeystore
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isReturnDefaultValues = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":design"))
    implementation(project(":ink"))
    implementation(project(":data"))
    implementation(project(":sync"))
    implementation(project(":pdf"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.activity)
    implementation(libs.appcompat)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coroutines.android)
    implementation(libs.room.ktx)
    implementation(libs.lifecycle.runtime.compose)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation(libs.testng)
}

tasks.withType<Test>().configureEach { useTestNG() }
