const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static('./'));

// Store polls in memory (in a real app, you'd use a database)
const polls = new Map();
const userVotes = new Map(); // Track user votes

// Helper function to check if a poll has expired
const isPollExpired = (poll) => {
    if (!poll.expiresAt) return false;
    return new Date() > new Date(poll.expiresAt);
};

// Helper function to get poll results
const getPollResults = (poll) => {
    const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);
    return {
        ...poll,
        totalVotes,
        options: poll.options.map(option => ({
            ...option,
            percentage: totalVotes > 0 ? (option.votes / totalVotes * 100).toFixed(1) : 0
        }))
    };
};

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected');
    const userId = socket.id;

    // Send existing polls to new users immediately
    const activePolls = Array.from(polls.values())
        .filter(poll => !isPollExpired(poll))
        .map(getPollResults);
    socket.emit('existingPolls', activePolls);

    // Handle request for existing polls
    socket.on('requestPolls', () => {
        const activePolls = Array.from(polls.values())
            .filter(poll => !isPollExpired(poll))
            .map(getPollResults);
        socket.emit('existingPolls', activePolls);
    });

    // Handle new poll creation
    socket.on('createPoll', (poll) => {
        try {
            console.log('Creating new poll:', poll);
            const pollId = Date.now().toString();
            const newPoll = {
                id: pollId,
                question: poll.question,
                options: poll.options.map(option => ({
                    text: option.text,
                    votes: 0
                })),
                createdAt: new Date().toISOString(),
                createdBy: userId,
                expiresAt: poll.duration ? new Date(Date.now() + poll.duration * 60000).toISOString() : null,
                isPrivate: poll.isPrivate || false,
                allowMultipleVotes: poll.allowMultipleVotes || false
            };
            
            polls.set(pollId, newPoll);
            console.log('Poll created successfully:', newPoll);
            
            // Broadcast to all clients including sender
            io.emit('pollCreated', getPollResults(newPoll));
            
            // Send confirmation to creator
            socket.emit('pollCreated', getPollResults(newPoll));
        } catch (error) {
            console.error('Error creating poll:', error);
            socket.emit('error', { message: 'Failed to create poll' });
        }
    });

    // Handle votes
    socket.on('vote', ({ pollId, optionIndex }) => {
        try {
            const poll = polls.get(pollId);
            if (!poll) {
                socket.emit('error', { message: 'Poll not found' });
                return;
            }

            if (isPollExpired(poll)) {
                socket.emit('error', { message: 'This poll has expired' });
                return;
            }

            // Check if user has already voted
            const userVote = userVotes.get(userId) || new Set();
            if (!poll.allowMultipleVotes && userVote.has(pollId)) {
                socket.emit('error', { message: 'You have already voted on this poll' });
                return;
            }

            if (poll.options[optionIndex]) {
                poll.options[optionIndex].votes++;
                userVote.add(pollId);
                userVotes.set(userId, userVote);
                io.emit('voteUpdate', getPollResults(poll));
            } else {
                socket.emit('error', { message: 'Invalid option selected' });
            }
        } catch (error) {
            console.error('Error processing vote:', error);
            socket.emit('error', { message: 'Failed to process vote' });
        }
    });

    // Handle poll deletion
    socket.on('deletePoll', ({ pollId }) => {
        const poll = polls.get(pollId);
        if (poll && poll.createdBy === userId) {
            polls.delete(pollId);
            io.emit('pollDeleted', pollId);
        } else {
            socket.emit('error', { message: 'You cannot delete this poll' });
        }
    });

    // Handle poll expiration check
    setInterval(() => {
        const activePolls = Array.from(polls.values())
            .filter(poll => !isPollExpired(poll))
            .map(getPollResults);
        io.emit('pollsUpdate', activePolls);
    }, 60000); // Check every minute

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).send('Something went wrong!');
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Available routes:');
    console.log(`- http://localhost:${PORT}/`);
}); 
