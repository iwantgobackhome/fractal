plugins { alias(libs.plugins.android.library); alias(libs.plugins.kotlin.android); alias(libs.plugins.kotlin.compose); alias(libs.plugins.kotlin.serialization) }
android { namespace = "app.fractal.ink"; compileSdk = 35
    defaultConfig { minSdk = 29 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    implementation(project(":design"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui); implementation(libs.compose.foundation); implementation(libs.compose.material3)
    implementation(libs.ink.authoring); implementation(libs.ink.rendering); implementation(libs.ink.strokes)
    implementation(libs.ink.geometry); implementation(libs.ink.brush); implementation(libs.ink.storage)
    implementation(libs.motionprediction)
    implementation(libs.serialization.json); implementation(libs.datastore)
    testImplementation(libs.testng)
}
tasks.withType<Test>().configureEach { useTestNG() }
