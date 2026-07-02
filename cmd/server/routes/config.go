package routes

import (
	"net/http"

	"kubecmds-viz/server/store"
)

func registerConfig(mux *http.ServeMux) {
	// GET /api/config: resource kinds + per-kind command templates. Must match
	// the Node route's payload shape (api/routes/config.js) — the frontend
	// falls back to generic panel chips when templates are missing.
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"resources": store.LoadResources(),
			"templates": store.LoadTemplates(),
		})
	})
}
