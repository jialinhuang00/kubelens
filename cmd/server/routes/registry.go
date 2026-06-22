package routes

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

const recentTags = 20

var (
	ecrURLPattern = regexp.MustCompile(`^(\d+)\.dkr\.ecr\.([^.]+)\.amazonaws\.com/([^:]+)`)
	garURLPattern = regexp.MustCompile(`^([a-z0-9-]+)-docker\.pkg\.dev/([^/]+)/([^/]+)/([^:]+)`)
	gcrURLPattern = regexp.MustCompile(`^gcr\.io/([^/]+)/([^:]+)`)
	acrURLPattern = regexp.MustCompile(`^([^.]+)\.azurecr\.io/([^:]+)`)
)

// cliFor maps a registry type to the CLI binary it shells out to.
var cliFor = map[string]string{"ecr": "aws", "gar": "gcloud", "gcr": "gcloud", "acr": "az"}

type registryInfo struct {
	regType    string
	account    string
	region     string
	repository string
	path       string
	registry   string
}

func registerRegistry(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/registry/tags", handleRegistryTags)
}

// parseRegistry classifies an image URL by host and extracts the parts each
// fetcher needs. Returns nil for unsupported registries.
func parseRegistry(image string) *registryInfo {
	if m := ecrURLPattern.FindStringSubmatch(image); m != nil {
		return &registryInfo{regType: "ecr", account: m[1], region: m[2], repository: m[3]}
	}
	if m := garURLPattern.FindStringSubmatch(image); m != nil {
		return &registryInfo{
			regType:    "gar",
			path:       m[1] + "-docker.pkg.dev/" + m[2] + "/" + m[3] + "/" + m[4],
			repository: m[3] + "/" + m[4],
		}
	}
	if m := gcrURLPattern.FindStringSubmatch(image); m != nil {
		return &registryInfo{regType: "gcr", path: "gcr.io/" + m[1] + "/" + m[2], repository: m[2]}
	}
	if m := acrURLPattern.FindStringSubmatch(image); m != nil {
		return &registryInfo{regType: "acr", registry: m[1], repository: m[2]}
	}
	return nil
}

// GET /api/registry/tags?image=<full-image-url>
// Detects the registry from the image URL, shells out to the matching cloud
// CLI, and returns the most recent tags. Same response shape across registries.
func handleRegistryTags(w http.ResponseWriter, r *http.Request) {
	image := r.URL.Query().Get("image")
	if image == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"tags": []string{}, "repository": "", "error": "Missing image query parameter"})
		return
	}

	info := parseRegistry(image)
	if info == nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"tags": []string{}, "repository": "", "error": "Unsupported registry"})
		return
	}

	var (
		tags []string
		err  error
	)
	switch info.regType {
	case "ecr":
		tags, err = fetchECRTags(info)
	case "gar":
		tags, err = fetchGARTags(info)
	case "gcr":
		tags, err = fetchGCRTags(info)
	case "acr":
		tags, err = fetchACRTags(info)
	}

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"tags": []string{}, "repository": info.repository, "error": cliError(err, info.regType)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags, "repository": info.repository})
}

// cliError turns a command failure into a message, with a clear hint when the
// CLI binary itself is missing.
func cliError(err error, regType string) string {
	if errors.Is(err, exec.ErrNotFound) {
		return cliFor[regType] + " CLI not found — install it to load tags for this registry"
	}
	if ee, ok := err.(*exec.ExitError); ok {
		if msg := strings.TrimSpace(string(ee.Stderr)); msg != "" {
			return msg
		}
	}
	return err.Error()
}

func fetchECRTags(info *registryInfo) ([]string, error) {
	env := os.Environ()
	if profileMapJSON := os.Getenv("ECR_PROFILE_MAP"); profileMapJSON != "" {
		var profileMap map[string]string
		if json.Unmarshal([]byte(profileMapJSON), &profileMap) == nil {
			if profile, ok := profileMap[info.account]; ok {
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
		"--repository-name", info.repository,
		"--region", info.region,
		"--query", "sort_by(imageDetails,&imagePushedAt)[-"+strconv.Itoa(recentTags)+":]",
		"--output", "json",
		"--no-cli-pager",
	)
	cmd.Env = env
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var imageDetails []struct {
		ImageTags []string `json:"imageTags"`
	}
	if err := json.Unmarshal(out, &imageDetails); err != nil {
		return nil, err
	}
	tags := []string{}
	for i := len(imageDetails) - 1; i >= 0; i-- {
		for _, tag := range imageDetails[i].ImageTags {
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}
	return tags, nil
}

func fetchGARTags(info *registryInfo) ([]string, error) {
	out, err := exec.Command("gcloud",
		"artifacts", "docker", "tags", "list", info.path,
		"--format=json", "--limit="+strconv.Itoa(recentTags),
	).Output()
	if err != nil {
		return nil, err
	}
	var entries []struct {
		Tag string `json:"tag"`
	}
	if err := json.Unmarshal(out, &entries); err != nil {
		return nil, err
	}
	tags := []string{}
	for _, e := range entries {
		if e.Tag == "" {
			continue
		}
		parts := strings.Split(e.Tag, "/")
		tags = append(tags, parts[len(parts)-1])
	}
	return tags, nil
}

func fetchGCRTags(info *registryInfo) ([]string, error) {
	out, err := exec.Command("gcloud",
		"container", "images", "list-tags", info.path,
		"--format=json", "--limit="+strconv.Itoa(recentTags),
	).Output()
	if err != nil {
		return nil, err
	}
	var entries []struct {
		Tags []string `json:"tags"`
	}
	if err := json.Unmarshal(out, &entries); err != nil {
		return nil, err
	}
	tags := []string{}
	for _, e := range entries {
		for _, tag := range e.Tags {
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}
	return tags, nil
}

func fetchACRTags(info *registryInfo) ([]string, error) {
	out, err := exec.Command("az",
		"acr", "repository", "show-tags",
		"--name", info.registry,
		"--repository", info.repository,
		"--top", strconv.Itoa(recentTags),
		"--output", "json",
	).Output()
	if err != nil {
		return nil, err
	}
	var tags []string
	if err := json.Unmarshal(out, &tags); err != nil {
		return nil, err
	}
	cleaned := []string{}
	for _, tag := range tags {
		if tag != "" {
			cleaned = append(cleaned, tag)
		}
	}
	return cleaned, nil
}
