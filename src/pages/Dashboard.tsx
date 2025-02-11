import React from 'react';
import { ChatInterface } from '../components/ChatInterface';

export default function Dashboard() {
  const [selectedRoom, setSelectedRoom] = React.useState<string | null>(null);
  const rooms = ['101', '104', '114', '119', '120'];

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">Medical Student Dashboard</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex gap-6 h-[calc(100vh-200px)]">
            {/* Room Selection Sidebar */}
            <div className="w-64 bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">Patient Rooms</h2>
              <div className="space-y-2">
                {rooms.map((room) => (
                  <button
                    key={room}
                    onClick={() => setSelectedRoom(room)}
                    className={`w-full p-3 text-left rounded-lg transition-colors ${
                      selectedRoom === room
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    Room {room}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Interface */}
            <div className="flex-1">
              {selectedRoom ? (
                <ChatInterface roomNumber={selectedRoom} />
              ) : (
                <div className="h-full flex items-center justify-center bg-white rounded-lg shadow">
                  <p className="text-gray-500">Select a room to start chatting</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}