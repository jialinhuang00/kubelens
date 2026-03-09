package routes

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

var ecrURLPattern = regexp.MustCompile(`^(\d+)\.dkr\.ecr\.([^.]+)\.amazonaws\.com/([^:]+)`)

func registerECR(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/ecr/tags", handleECRTags)
}

// GET /api/ecr/tags?image=<full-ecr-image-url>
// Parses ECR repo + region from image URL, calls aws ecr describe-images,
// returns 10 most recent tags. Triggered when user clicks a container image
// in pod detail view.
func handleECRTags(w http.ResponseWriter, r *http.Request) {
	image := r.URL.Query().Get("image")
	if image == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"tags": []string{}, "error": "Missing image query parameter"})
		return
	}

	m := ecrURLPattern.FindStringSubmatch(image)
	if m == nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"tags": []string{}, "error": "Not a valid ECR image URL"})
		return
	}
	accountID, region, repository := m[1], m[2], m[3]

	// Account → SSO profile map from ECR_PROFILE_MAP env var.
	env := os.Environ()
	if profileMapJSON := os.Getenv("ECR_PROFILE_MAP"); profileMapJSON != "" {
		var profileMap map[string]string
		if json.Unmarshal([]byte(profileMapJSON), &profileMap) == nil {
			if profile, ok := profileMap[accountID]; ok {
				// Remove any existing AWS_PROFILE to avoid duplicates
				filtered := make([]string, 0, len(env))
				for _, e := range env {
					if !strings.HasPrefix(e, "AWS_PROFILE=") {
						filtered = append(filtered, e)
					}
				}
				env = append(filtered, "AWS_PROFILE="+profile)
			}
		}
	}

	cmd := exec.Command("aws",
		"ecr", "describe-images",
		"--repository-name", repository,
		"--region", region,
		"--query", "sort_by(imageDetails,&imagePushedAt)[-10:]",
		"--output", "json",
		"--no-cli-pager",
	)
	cmd.Env = env

	out, err := cmd.Output()
	if err != nil {
		var errMsg string
		if ee, ok := err.(*exec.ExitError); ok {
			errMsg = string(ee.Stderr)
		} else {
			errMsg = err.Error()
		}
		writeJSON(w, http.StatusOK, map[string]any{"tags": []string{}, "repository": repository, "error": errMsg})
		return
	}

	var imageDetails []struct {
		ImageTags []string `json:"imageTags"`
	}
	if err := json.Unmarshal(out, &imageDetails); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"tags": []string{}, "repository": repository, "error": "Failed to parse ECR response"})
		return
	}

	// Flatten tags newest-first, skip empty.
	tags := []string{}
	for i := len(imageDetails) - 1; i >= 0; i-- {
		for _, tag := range imageDetails[i].ImageTags {
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"tags": tags, "repository": repository})
}
