package emails

import (
	"context"
	"sync"

	"github.com/robinjoseph08/golib/logger"
)

// workerSupervisor serializes delivery activations. Its one-slot wake channel
// makes Wake bounded and nonblocking: simultaneous wakes collapse into one
// pending activation, including while the current activation is still running.
// Waiting is database-free and has no startup, idle, quota, or reconciliation
// timer: only an explicit wake starts an activation.
type workerSupervisor struct {
	activate func(context.Context)
	log      logger.Logger
	wake     chan struct{}
	done     chan struct{}
	runOnce  sync.Once
}

func newWorkerSupervisor(activate func(context.Context), log logger.Logger) *workerSupervisor {
	return &workerSupervisor{
		activate: activate,
		log:      log,
		wake:     make(chan struct{}, 1),
		done:     make(chan struct{}),
	}
}

func (s *workerSupervisor) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *workerSupervisor) Done() <-chan struct{} { return s.done }

func (s *workerSupervisor) Run(ctx context.Context) {
	// Run is process-lifetime state. Guarding it ensures even accidental
	// duplicate callers cannot start concurrent drain loops or close Done
	// twice. A concurrent duplicate waits for the active Run to finish.
	s.runOnce.Do(func() {
		defer close(s.done)
		s.log.Info("email worker started")
		defer s.log.Info("email worker stopped")

		for {
			select {
			case <-ctx.Done():
				return
			case <-s.wake:
			}

			// If shutdown raced with a pending wake, shutdown wins: finishing the
			// current activation must not lead to another claim.
			if ctx.Err() != nil {
				return
			}
			s.activate(ctx)
		}
	})
}
