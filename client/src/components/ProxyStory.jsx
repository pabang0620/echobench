// The proxy's record of a contract run, open by default: the two headers side by side and how many writes PayPal got.
export default function ProxyStory({ story }) {
  if (!story) return null
  return (
    <div className="proxy-story" aria-label="What the proxy saw">
      <h4>What the proxy saw</h4>
      <pre>{story.lines.join('\n')}</pre>
      {story.note && <p className="small muted">{story.note}</p>}
    </div>
  )
}
