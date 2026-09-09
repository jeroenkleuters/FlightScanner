import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the shell element', () => {
    const { container } = render(<App />)

    expect(container.querySelector('.app-shell')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
