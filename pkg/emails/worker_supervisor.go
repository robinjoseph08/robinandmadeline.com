package emails

import (
	"context"
	"sync"
	"time"

	"github.com/robinjoseph08/golib/logger"
)

// workerSupervisor serializes delivery activations. Its one-slot wake channel
// makes Wake bounded and nonblocking: simultaneous wakes collapse into one
// pending activation, including while the current activation is still running.
// Polling remains alongside explicit wakes until demand-started delivery is
// wired in a later change.
type workerSupervisor struct {
	pollInterval time.Duration
	activate     func(context.Context)
	log          logger.Logger
	wake         chan struct{}
	done         chan struct{}
	runOnce      sync.Once
}

func newWorkerSupervisor(pollInterval time.Duration, activate func(context.Context), log logger.Logger) *workerSupervisor {
	return &workerSupervisor{
		pollInterval: pollInterval,
		activate:     activate,
		log:          log,
		wake:         make(chan struct{}, 1),
		done:         make(chan struct{}),
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

		// Preserve the existing immediate startup activation. Production polling
		// also remains active until the demand-start ticket removes both.
		s.activate(ctx)
		for {
			if ctx.Err() != nil {
				return
			}

			timer := time.NewTimer(s.pollInterval)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-s.wake:
				timer.Stop()
			case <-timer.C:
			}

			// If shutdown raced with a pending wake or poll tick, shutdown wins:
			// finishing the current activation must not lead to another claim.
			if ctx.Err() != nil {
				return
			}
			s.activate(ctx)
		}
	})
}
