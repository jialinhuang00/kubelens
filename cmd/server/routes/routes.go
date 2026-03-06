package routes

import (
	"net/http"
	"os"
)

func Register(mux *http.ServeMux) {
	registerStatus(mux)
	registerECR(mux)
	registerResourceCounts(mux)
	registerExecute(mux)
	registerK8sExport(mux)
	registerGraph(mux)
	registerStream(mux)
	mux.HandleFunc("GET /explainer", func(w http.ResponseWriter, r *http.Request) {
		data, err := os.ReadFile("explainer.html")
		if err != nil {
			http.Error(w, "explainer.html not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
}
