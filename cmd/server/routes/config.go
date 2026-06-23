package routes

import (
	"net/http"

	"kubecmds-viz/server/store"
)

func registerConfig(mux *http.ServeMux) {
	// GET /api/config: resource kinds the app knows about. Frontend reads this
	// at startup instead of hardcoding the list.
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"resources": store.LoadResources()})
	})
}
