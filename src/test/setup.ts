import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without global test APIs, so React Testing Library's automatic
// cleanup never registers. Without this, rendered trees pile up across tests in
// the same file and queries match elements from an earlier test.
afterEach(cleanup)
