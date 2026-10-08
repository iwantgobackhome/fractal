plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.fractal.sync"
    compileSdk = 35
    defaultConfig { minSdk = 29 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":data"))
    implementation(libs.room.ktx)
    implementation(libs.okhttp)
    implementation(libs.work.runtime)
    implementation(libs.serialization.json)
    testImplementation(libs.testng)
    testImplementation("org.mockito:mockito-core:5.18.0")
}

tasks.withType<Test>().configureEach { useTestNG() }
