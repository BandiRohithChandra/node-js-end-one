const express = require('express')
const path = require('path')
const app = express()
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
let db = null
const dbPath = path.join(__dirname, 'twitterClone.db')
app.use(express.json())

const initializeAndDbServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at localhost:3000/')
    })
  } catch (e) {
    console.log(`Db Error: ${e.message}`)
    process.exit(1)
  }
}

initializeAndDbServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(request.body.password, 10)
  const selectUserQuery = `
    SELECT * 
    FROM 
    user
    WHERE
    username = '${username}'`
  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    const insertQuery = `
        INSERT INTO
        user(username, password, name, gender)
        VALUES(
            '${username}',
            '${hashedPassword}', 
            '${name}',
            '${gender}'
        )`
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const createUser = await db.run(insertQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const loginQuery = `
  SELECT *
  FROM user
  WHERE
  username = '${username}'`
  const dbUser = await db.get(loginQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeaders = request.headers['authorization']
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.payload = payload
        next()
      }
    })
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const username = request.payload.username
  const getuserIdQuery = `
  SELECT user_id
  FROM user
  WHERE 
  username = ?`

  const {userId} = await db.get(getuserIdQuery, [username])

  const getTweetsQuery = `
  SELECT 
  user.username , tweet.tweet, tweet.date_time AS dateTime
  FROM 
  tweet 
  INNER JOIN follower ON tweet.user_id = follower.following_user_id 
  INNER JOIN user ON follower.following_user_id = user.user_id 
  WHERE
  follower.following_user_id = ?
  ORDER BY tweet.date_time DESC
  LIMIT 4

  `
  const tweetDetails = await db.all(getTweetsQuery, [userId])
  response.send(tweetDetails)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request.payload.username
  const getuserFollowingQuery = `
  SELECT user.name
  FROM 
  user
  INNER JOIN follower ON user.user_id = follower.following_user_id
  INNER JOIN user ON follower.follower_user_id = user.user_id
  WHERE user.username = ?
  `
  const followingList = await db.all(getuserFollowingQuery, [username])
  response.send(followingList)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const followingQuery = `
  SELECT user.name
  FROM user AS u
  INNER JOIN follower AS f ON u.user_id = f.follower_user_id
  INNER JOIN user AS cu ON f.following_user_id = cu.user_id
  WHERE 
  cu.username = ?
  `
  const usersList = await db.all(followingQuery)
  response.send(usersList)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request.payload
  const tweetQuery = `
  SELECT tweet.tweet,
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  tweet.date_time AS dateTime
  FROM 
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  LEFT JOIN reply ON tweet.tweet_id = reply.reply_id
  WHERE
  tweet.tweet_id = ${tweetId}
  `
  const tweetDeatils = await db.get(tweetQuery)
  if (!tweetDeatils) {
    response.status(401)
    response.send('Invalid Request')
    return
  }

  const followingQuery = `
  SELECT follower_id
  FROM follower
  WHERE
  follower_user_id = ? AND following_user_id = (
    SELECT user_id
    FROM tweet
    WHERE
    tweet_id = ?
  )`

  const followingDetails = await db.get(followingQuery)
  if (!followingDetails) {
    response.status(401).send('Invalid Request')
    return
  }

  response.send({
    tweet: tweetDeatils.tweet,
    likes: tweetDeatils.likes,
    replies: tweetDeatils.replies,
    dateTime: tweetDeatils.dateTime,
  })
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const followingQuery = `
  SELECT follower_id
  FROM follower
  WHERE
  follower_user_id = ? AND following_user_id = (
    SELECT user_id
    FROM tweet
    WHERE tweet_id = ?
  )`
    const followingList = await db.get(followingQuery)
    if (!followingList) {
      response.status(401).send('Invalid Request')
    }

    const likesQuery = `
  SELECT user.name 
  FROM like
  INNER JOIN user ON like.user_id = user.user_id
  WHERE like.tweet_id = ? 
  `
    const likesList = await db.get(likesQuery)
    response.send({
      likes: likes.map(everyLike => everyLike.username),
    })
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const followerQuery = `
  SELECT follower_id
  FROM follower
  WHERE follower_user_id = ? AND following_user_id = (
    SELECT user_id
    FROM tweet
    WHERE tweet_id = ?
  )`
    const followerDetails = await db.get(followerQuery)
    if (!followerDetails) {
      response.status(401).send('Invalid Request')
    }

    const replyQuery = `
  SELECT user.name, 
  reply.reply
  FROM
  reply 
  INNER JOIN user ON reply.user_id = user.user_id 
  WHERE 
  reply.tweet_id = ?
  `
    const tweetDetails = await db.get(replyQuery)
    response.send({tweetDetails})
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const userTweetQuery = `
  SELECT tweet.tweet,
  COUNT(like.like_id) AS likes,
  COUNT(reply.reply_id) AS replies,
  tweet.date_time AS dateTime
  FROM
  tweet
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
  WHERE tweet.user_id = ?
  GROUP BY tweet.tweet_id
  ORDER BY tweet.date_time DESC
  `
  const tweetsUser = await db.all(userTweetQuery)
  response.send(tweetsUser)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const {userId} = request.payload
  const insertQuery = `
  INSERT INTO tweet(tweet, user_id, date_time)
  VALUES(
    ?,?,datetime('now')
    
  )`

  await db.run(insertQuery)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request.payload
    const deleteQuery = `
  SELECT * 
  FROM tweet
  WHERE 
  tweet_id = ?`
    const tweetDetails = await db.get(deleteQuery)
    if (!tweetDetails) {
      response.status(404).send('Tweet not found')
      return
    }

    if (tweet.user_id !== userId) {
      response.status(401).send('Invalid Request')
      return
    }

    const deleteTweetQuery = `
DELETE FROM
WHERE tweet_id = ?

`

    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  },
)

module.exports = app
