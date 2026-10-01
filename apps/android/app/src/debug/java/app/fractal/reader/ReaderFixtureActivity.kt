package app.fractal.reader

import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import app.fractal.ink.ReaderInputHost

/** Empty debug-only host: a single test-owned composition with the production native input parent. */
class ReaderFixtureActivity : AppCompatActivity() {
    override fun setContentView(view: View?, params: ViewGroup.LayoutParams?) {
        if (view == null || view is ReaderInputHost) super.setContentView(view, params)
        else super.setContentView(ReaderInputHost(this).apply {
            addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }, params)
    }
}
