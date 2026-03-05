package routes

import "net/http"

func Register(mux *http.ServeMux) {
	registerStatus(mux)
	registerECR(mux)
	registerResourceCounts(mux)
	registerExecute(mux)
	registerK8sExport(mux)
	registerGraph(mux)
	registerStream(mux)
}
