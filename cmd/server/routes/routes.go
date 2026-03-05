package routes

import "net/http"

func Register(mux *http.ServeMux) {
	registerStatus(mux)
}
