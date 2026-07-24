package emails

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/robinjoseph08/golib/logger"
	"github.com/stretchr/testify/assert"
)

func lifecycleTestWorker(activate func(context.Context)) *Worker {
	return &Worker{
		supervisor: newWorkerSupervisor(time.Hour, activate, logger.New()),
	}
}

func waitForSignal(t *testing.T, signal <-chan struct{}, message string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal(message)
	}
}

func TestWorkerWake_IsBoundedAndDoesNotActivateInline(t *testing.T) {
	worker := NewWorker(nil, nil, WorkerConfig{PollInterval: time.Hour}, logger.New())
	returned := make(chan struct{})

	go func() {
		defer close(returned)
		for range 100 {
			worker.Wake()
		}
	}()

	waitForSignal(t, returned, "Wake blocked without a running worker")
	select {
	case <-worker.Done():
		t.Fatal("Wake started the worker in the caller")
	default:
	}
}

func TestWorkerWake_CoalescesConcurrentSignalsWithoutConcurrentCycles(t *testing.T) {
	var calls atomic.Int32
	var active atomic.Int32
	var maxActive atomic.Int32
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondStarted := make(chan struct{})

	worker := lifecycleTestWorker(func(ctx context.Context) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			maximum := maxActive.Load()
			if current <= maximum || maxActive.CompareAndSwap(maximum, current) {
				break
			}
		}

		switch calls.Add(1) {
		case 1:
			close(firstStarted)
			<-releaseFirst
		case 2:
			close(secondStarted)
			<-ctx.Done()
		}
	})

	runCtx, cancel := context.WithCancel(context.Background())
	go worker.Run(runCtx)
	waitForSignal(t, firstStarted, "initial worker cycle did not start")

	const signalers = 100
	var signals sync.WaitGroup
	signals.Add(signalers)
	for range signalers {
		go func() {
			defer signals.Done()
			worker.Wake()
		}()
	}
	signals.Wait()
	assert.Equal(t, int32(1), calls.Load(), "Wake must not run a cycle in the caller")
	assert.Len(t, worker.supervisor.wake, 1, "simultaneous wakes must collapse into one pending activation")

	close(releaseFirst)
	waitForSignal(t, secondStarted, "coalesced wake did not run another cycle")
	cancel()
	waitForSignal(t, worker.Done(), "worker did not stop")

	assert.Equal(t, int32(2), calls.Load())
	assert.Equal(t, int32(1), maxActive.Load())
}

func TestWorkerRun_PreservesIntervalPolling(t *testing.T) {
	activated := make(chan struct{}, 2)
	worker := &Worker{
		supervisor: newWorkerSupervisor(time.Millisecond, func(context.Context) {
			activated <- struct{}{}
		}, logger.New()),
	}

	runCtx, cancel := context.WithCancel(context.Background())
	go worker.Run(runCtx)
	waitForSignal(t, activated, "initial worker cycle did not start")
	waitForSignal(t, activated, "poll interval did not start another cycle")

	cancel()
	waitForSignal(t, worker.Done(), "worker did not stop")
}

func TestWorkerRun_ConcurrentCallsDoNotStartConcurrentCycles(t *testing.T) {
	var calls atomic.Int32
	var active atomic.Int32
	var maxActive atomic.Int32
	started := make(chan struct{}, 2)
	release := make(chan struct{})

	worker := lifecycleTestWorker(func(context.Context) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			maximum := maxActive.Load()
			if current <= maximum || maxActive.CompareAndSwap(maximum, current) {
				break
			}
		}
		calls.Add(1)
		started <- struct{}{}
		<-release
	})

	runCtx, cancel := context.WithCancel(context.Background())
	returned := make(chan struct{}, 2)
	go func() {
		worker.Run(runCtx)
		returned <- struct{}{}
	}()
	waitForSignal(t, started, "initial worker cycle did not start")

	secondCalling := make(chan struct{})
	go func() {
		close(secondCalling)
		worker.Run(runCtx)
		returned <- struct{}{}
	}()
	waitForSignal(t, secondCalling, "second Run caller did not start")

	select {
	case <-started:
		t.Fatal("concurrent Run call started another cycle")
	case <-time.After(100 * time.Millisecond):
	}
	assert.Equal(t, int32(1), calls.Load())
	assert.Equal(t, int32(1), maxActive.Load())

	cancel()
	close(release)
	waitForSignal(t, returned, "first Run caller did not return")
	waitForSignal(t, returned, "second Run caller did not return")
	waitForSignal(t, worker.Done(), "worker did not stop")
}

func TestWorkerRun_ShutdownDuringInFlightCycleFinishesWithoutAnotherCycle(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})

	worker := lifecycleTestWorker(func(context.Context) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			close(finished)
		}
	})

	runCtx, cancel := context.WithCancel(context.Background())
	go worker.Run(runCtx)
	waitForSignal(t, started, "initial worker cycle did not start")

	worker.Wake()
	cancel()
	select {
	case <-worker.Done():
		t.Fatal("worker stopped before its in-flight cycle finished")
	default:
	}

	close(release)
	waitForSignal(t, finished, "in-flight worker cycle did not finish")
	waitForSignal(t, worker.Done(), "worker did not stop after its cycle finished")
	assert.Equal(t, int32(1), calls.Load(), "pending wake started a cycle during shutdown")
}

func TestWorkerWake_DuringIdleTransitionCausesAnotherActionableWorkCheck(t *testing.T) {
	var calls atomic.Int32
	var actionable atomic.Bool
	var firstSawActionable atomic.Bool
	lastCheckReached := make(chan struct{})
	leaveIdleTransition := make(chan struct{})
	actionableChecked := make(chan struct{})

	worker := lifecycleTestWorker(func(ctx context.Context) {
		switch calls.Add(1) {
		case 1:
			firstSawActionable.Store(actionable.Load())
			close(lastCheckReached)
			<-leaveIdleTransition
		case 2:
			if actionable.Swap(false) {
				close(actionableChecked)
			}
			<-ctx.Done()
		}
	})

	runCtx, cancel := context.WithCancel(context.Background())
	go worker.Run(runCtx)
	waitForSignal(t, lastCheckReached, "worker did not reach its idle transition")

	// Actionable work appears after the activation's final check but before it
	// can wait. The wake must remain pending across that transition.
	actionable.Store(true)
	worker.Wake()
	close(leaveIdleTransition)
	waitForSignal(t, actionableChecked, "wake was lost during the idle transition")

	cancel()
	waitForSignal(t, worker.Done(), "worker did not stop")
	assert.False(t, firstSawActionable.Load())
	assert.Equal(t, int32(2), calls.Load())
}
