// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Checkbox, Input, Select, Textarea } from './kit'
import { BUTTON_VARIANT, FIELD } from './tokens'

describe('Button variants', () => {
  it('renders the two added variants from the one token set', () => {
    const { rerender } = render(<Button variant="link">Done</Button>)
    const link = screen.getByRole('button', { name: 'Done' })
    expect(link.className).toContain(BUTTON_VARIANT.link)
    expect(link.className).toContain(BUTTON_VARIANT.link.split(' ')[0])

    rerender(<Button variant="info">Validate Deck</Button>)
    const info = screen.getByRole('button', { name: 'Validate Deck' })
    expect(info.className).toContain(BUTTON_VARIANT.info)
    expect(info.className).not.toContain(BUTTON_VARIANT.link)
  })

  it('keeps the shared disabled and type contract on the new variants', () => {
    render(<Button variant="link" type="submit" disabled>Save</Button>)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('type', 'submit')
  })
})

describe('Field primitives', () => {
  it('gives input, textarea and select the same field recipe', () => {
    render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Bio" />
        <Select aria-label="Expiry"><option>1 hour</option></Select>
      </>,
    )
    for (const label of ['Name', 'Bio', 'Expiry']) {
      expect(screen.getByLabelText(label).className).toContain(FIELD.base)
    }
    expect(screen.getByLabelText('Name').className).toContain(FIELD.input)
    expect(screen.getByLabelText('Bio').className).toContain(FIELD.textarea)
    expect(screen.getByLabelText('Expiry').className).toContain(FIELD.select)
  })

  it('renders bare fields without the bordered chrome', () => {
    render(
      <>
        <Input aria-label="Search" bare />
        <Textarea aria-label="Message" bare />
      </>,
    )
    expect(screen.getByLabelText('Search').className).toContain(FIELD.bare)
    expect(screen.getByLabelText('Search').className).not.toContain(FIELD.base)
    expect(screen.getByLabelText('Message').className).toContain(FIELD.bare)
  })

  it('forwards value changes and arbitrary props', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input aria-label="Tag" placeholder="Add a tag" maxLength={20} onChange={onChange} />)
    const tag = screen.getByLabelText('Tag')
    await user.type(tag, 'art')
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(tag).toHaveAttribute('maxlength', '20')
    expect(tag).toHaveAttribute('placeholder', 'Add a tag')
  })

  it('renders a checkbox with the one accent recipe', () => {
    render(<Checkbox aria-label="Encrypt" />)
    expect(screen.getByRole('checkbox', { name: 'Encrypt' }).className).toContain(FIELD.check)
  })
})
