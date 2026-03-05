package routes

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"kubecmds-viz/server/store"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// streamProcess tracks a running kubectl process for stop/clear.
type streamProcess struct {
	cmd    *exec.Cmd
	buffer string
	mu     sync.Mutex
}

var (
	streamsMu sync.Mutex
	streams   = map[string]*streamProcess{}
)

func registerStream(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/execute/stream/ws", handleStreamWS)
	mux.HandleFunc("POST /api/execute/stream/stop", handleStreamStop)
	mux.HandleFunc("POST /api/execute/stream/clear", handleStreamClear)
}

// GET /api/execute/stream/ws — WebSocket upgrade.
// Client sends first JSON message: { command, streamId, snapshot }.
// Server pushes stream-data, stream-end, stream-error events.
func handleStreamWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[stream] upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Read first message: { command, streamId, snapshot }
	var init struct {
		Command  string `json:"command"`
		StreamID string `json:"streamId"`
		Snapshot bool   `json:"snapshot"`
	}
	if err := conn.ReadJSON(&init); err != nil {
		log.Printf("[stream] read init: %v", err)
		return
	}

	if init.Command == "" || init.StreamID == "" {
		sendJSON(conn, map[string]any{
			"type":     "stream-error",
			"streamId": init.StreamID,
			"error":    "command and streamId are required",
		})
		return
	}

	log.Printf("[stream] start %s (id=%s snapshot=%v)", init.Command, init.StreamID, init.Snapshot)

	// Snapshot mode — fake the stream.
	if init.Snapshot {
		result := store.HandleCommand(init.Command)
		output := result.Stdout
		if !result.Success {
			output = result.Error
		}
		time.Sleep(300 * time.Millisecond)
		sendJSON(conn, map[string]any{
			"type":      "stream-data",
			"streamId":  init.StreamID,
			"dataType":  "stdout",
			"data":      output,
			"timestamp": time.Now().UnixMilli(),
		})
		time.Sleep(500 * time.Millisecond)
		sendJSON(conn, map[string]any{
			"type":       "stream-end",
			"streamId":   init.StreamID,
			"exitCode":   0,
			"fullOutput": output,
			"timestamp":  time.Now().UnixMilli(),
		})
		return
	}

	// Realtime mode.
	args := parseCommand(init.Command)
	cmd := exec.Command("kubectl", args...)

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	proc := &streamProcess{cmd: cmd}
	streamsMu.Lock()
	streams[init.StreamID] = proc
	streamsMu.Unlock()

	defer func() {
		// Kill kubectl if WebSocket closes before the process finishes
		// (e.g. user navigates away without pressing stop).
		if proc.cmd.Process != nil {
			proc.cmd.Process.Kill()
		}
		streamsMu.Lock()
		delete(streams, init.StreamID)
		streamsMu.Unlock()
	}()

	if err := cmd.Start(); err != nil {
		sendJSON(conn, map[string]any{
			"type":     "stream-error",
			"streamId": init.StreamID,
			"error":    err.Error(),
		})
		return
	}

	mu := sync.Mutex{} // serialise writes to the WebSocket conn

	pipe := func(reader interface{ Read([]byte) (int, error) }, typ string) {
		buf := make([]byte, 4096)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				proc.mu.Lock()
				proc.buffer += chunk
				proc.mu.Unlock()

				mu.Lock()
				sendJSON(conn, map[string]any{
					"type":      "stream-data",
					"streamId":  init.StreamID,
					"dataType":  typ,
					"data":      chunk,
					"timestamp": time.Now().UnixMilli(),
				})
				mu.Unlock()
			}
			if err != nil {
				break
			}
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); pipe(stdout, "stdout") }()
	go func() { defer wg.Done(); pipe(stderr, "stderr") }()
	wg.Wait()

	exitCode := 0
	if err := cmd.Wait(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		}
	}

	proc.mu.Lock()
	fullOutput := proc.buffer
	proc.mu.Unlock()

	mu.Lock()
	sendJSON(conn, map[string]any{
		"type":       "stream-end",
		"streamId":   init.StreamID,
		"exitCode":   exitCode,
		"fullOutput": fullOutput,
		"timestamp":  time.Now().UnixMilli(),
	})
	mu.Unlock()

	log.Printf("[stream] end %s (id=%s exit=%d)", init.Command, init.StreamID, exitCode)
}

// POST /api/execute/stream/stop — send SIGTERM to running process.
func handleStreamStop(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StreamID string `json:"streamId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.StreamID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "streamId is required"})
		return
	}

	streamsMu.Lock()
	proc, ok := streams[body.StreamID]
	streamsMu.Unlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "stream not found"})
		return
	}

	if proc.cmd.Process != nil {
		proc.cmd.Process.Kill()
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// POST /api/execute/stream/clear — clear server-side buffer.
func handleStreamClear(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StreamID string `json:"streamId"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	streamsMu.Lock()
	proc, ok := streams[body.StreamID]
	streamsMu.Unlock()

	if ok {
		proc.mu.Lock()
		proc.buffer = ""
		proc.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func sendJSON(conn *websocket.Conn, v any) {
	data, _ := json.Marshal(v)
	conn.WriteMessage(websocket.TextMessage, data)
}
