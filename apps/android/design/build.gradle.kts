plugins { alias(libs.plugins.android.library); alias(libs.plugins.kotlin.android); alias(libs.plugins.kotlin.compose) }
android { namespace = "app.fractal.design"; compileSdk = 35
    defaultConfig { minSdk = 29 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true }
    sourceSets["main"].java.srcDir(layout.buildDirectory.dir("generated/tokens"))
}
val copyTokens by tasks.registering(Copy::class) {
    from("../../../packages/shared/tokens/generated/FractalTokens.kt")
    into(layout.buildDirectory.dir("generated/tokens/app/fractal/design"))
}
tasks.matching { it.name.startsWith("compile") && it.name.contains("Kotlin") }.configureEach { dependsOn(copyTokens) }
dependencies { implementation(platform(libs.compose.bom)); implementation(libs.compose.ui); implementation(libs.compose.material3) }
