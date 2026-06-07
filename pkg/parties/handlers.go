package parties

// handler holds the dependencies for the parties/guests HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which the
// shared error handler renders. There is no per-package error translation.
type handler struct {
	service *Service
}
