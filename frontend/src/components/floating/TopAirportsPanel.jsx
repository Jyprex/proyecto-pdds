import React from 'react';

const TopAirportsPanel = React.memo(({ isVisible, airportRows, onHide }) => {
  if (!isVisible) {
    return null
  }

  return (
    <aside className="ct-panel">
      <div className="ct-panel-header">
        <p>AEROPUERTOS CON MAYOR OCUPACIÓN</p>
        <button
          type="button"
          className="ct-panel-close"
          onClick={onHide}
        >
          Ocultar
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>CIUDAD</th>
            <th>CAPACIDAD</th>
          </tr>
        </thead>
        <tbody>
          {airportRows.map((airport) => (
            <tr key={airport.icao || airport.city}>
              <td>{airport.city}</td>
              <td>{airport.capacity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
});

export default TopAirportsPanel
