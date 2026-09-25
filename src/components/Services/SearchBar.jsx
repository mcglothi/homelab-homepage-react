export function SearchBar({ query, setQuery, resultCount, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${query ? accent + '50' : '#ffffff10'}`,
      borderRadius: 10, padding: '10px 16px',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      boxShadow: query ? `0 0 16px ${accent}15` : 'none',
    }}>
      <span style={{ color: query ? accent : '#444', fontSize: 15, transition: 'color 0.2s' }}>⌕</span>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search services..."
        style={{
          background: 'transparent', border: 'none', outline: 'none',
          fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: '#ddd',
          flex: 1, caretColor: accent,
        }}
      />
      {query && (
        <>
          <span
            onClick={() => setQuery('')}
            style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 10,
              color: '#444', cursor: 'pointer', padding: '2px 6px',
              border: '1px solid #333', borderRadius: 4,
            }}
          >✕</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: accent }}>
            {resultCount} result{resultCount !== 1 ? 's' : ''}
          </span>
        </>
      )}
    </div>
  )
}
