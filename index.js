const serverless = require("serverless-http");
const express = require("express");
const aws = require("aws-sdk");
const jwt = require("jsonwebtoken");
const dynamo = new aws.DynamoDB.DocumentClient();
const s3 = new aws.S3({
  region: "ap-northeast-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID_S3,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_S3,
});
const { v4: uuidv4 } = require("uuid");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const sharp = require("sharp");
const cors = require("cors");
const upload = multer();
const app = express();
const axios = require("axios");
const webpush = require("web-push");

app.use(
  cors({
    origin: "https://42greenbox.com",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

const init = async (id) => {
  const params = {
    TableName: "user",
    Item: Object.assign(
      {},
      { user_id: id, point: 0, item_cnt: 0 },
      {
        createdAt: new Date().getTime(),
      }
    ),
  };
  await dynamo.put(params).promise();
  return params.Item;
};

const uploadImage = async (imgBuffer) => {
  const params = {
    Bucket: "greenbox-img",
    Body: imgBuffer,
    Key: `img/${uuidv4()}.png`,
  };
  await s3
    .upload(params)
    .promise()
    .catch((err) => {
      console.log(err);
    });
  return params.Key;
};

app.get("/", function (req, res) {
  res.send({});
});
app.get("/login", function (req, res) {
  res.send({
    token: jwt.sign({ id: req.body.id }, "1234"),
  });
});
app.get("/ftlogin", function (req, res) {
  res.redirect(
    "https://api.intra.42.fr/oauth/authorize?client_id=u-s4t2ud-fe6c97dbab8c4b4887351c092d63312cd1e777de433c0889ba4a3847aee1599d&redirect_uri=https%3A%2F%2Fserver.42greenbox.com%2Fftlogin%2Freturn&response_type=code"
  );
});

app.get("/ftlogin/return", async function (req, res) {
  const token = await axios({
    url: "https://api.intra.42.fr/oauth/token",
    method: "post",
    data: {
      grant_type: "authorization_code",
      code: req.query.code,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      redirect_uri: process.env.REDIRECT_URI,
    },
  })
    .then((res) => res.data.access_token)
    .catch((err) => {
      console.log(err);
    });
  const me = await axios({
    url: "https://api.intra.42.fr/v2/me",
    method: "get",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).catch((err) => {
    console.log(err);
  });

  res.cookie("token", `${jwt.sign({ id: me.data.login }, "1234")}`, {
    sameSite: "None",
    secure: true, // HTTPS를 사용할 때만 쿠키가 전송됩니다.
    maxAge: 1000 * 60 * 60 * 24, // 쿠키 만료 시간 (예: 1일)
    domain: ".42greenbox.com",
  });
  res.redirect(process.env.MAIN_URL);
});

app.get("/user/me", async function (req, res) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const userId = jwt.verify(token, "1234", (err, user) => {
    console.log(user.id);
    return user.id; // Assume that user object has a field called 'id'
  });
  let result;
  const params = {
    TableName: "user",
    KeyConditionExpression: "user_id = :user_id",
    ExpressionAttributeValues: {
      ":user_id": userId,
    },
  };

  try {
    const data = await dynamo.query(params).promise();
    console.log("Items:", data.Items);
    if (data.Items.length === 0) res.send(await init(userId));
    result = data.Items[0];
  } catch (error) {
    console.error("Error retrieving items:", JSON.stringify(error, null, 2));
    result = { error };
  }
  res.send(result);
});

// axios 로 외부로 ~ 최 후순위
app.get("/item", function (req, res) {
  res.send(
    [
      {
        item_id: 0,
        name: "쵸코비",
      },
      {
        id: 1,
        name: "빼빼로",
      },
      {
        id: 2,
        name: "콜라",
      },
      {
        id: 3,
        name: "우유",
      },
    ][req.query.id]
  );
});

app.get("/storage", async function (req, res) {
  const userId = req.query.user_id;
  const itemId = req.query.item_id;
  let response;
  if (userId && itemId) {
    response = await getItemWithId(userId, itemId);
    console.log("response : ", response);
    res.send(response);
  } else {
    response = await getItem();
    // 여기 안에서 찍어봄
    res.send(response);
  }
});

async function getItem() {
  const tableName = "storage";
  const params = {
    TableName: tableName,
    IndexName: "IsExistIndex",
    KeyConditionExpression: "#isExistAttr = :isExistVal",
    ExpressionAttributeNames: {
      "#isExistAttr": "isExist",
    },
    ExpressionAttributeValues: {
      ":isExistVal": "true",
    },
  };
  try {
    const data = await dynamo.query(params).promise();
    console.log("Items:", data.Items);
    const result = data.Items;
    // res.send(result);
    return result;
  } catch (error) {
    console.error("Error retrieving items:", JSON.stringify(error, null, 2));
    // res.status(500).send({ error: "Internal server error" });
    return error;
  }
}

async function getItemWithId(userId, itemId) {
  let response;
  const tableName = "storage";
  const params = {
    TableName: tableName,
    KeyConditionExpression: "user_id = :userId and item_id = :itemId",
    ExpressionAttributeValues: {
      ":userId": userId,
      ":itemId": itemId,
    },
  };
  try {
    const data = await dynamo.query(params).promise();
    console.log("item data : ", data);
    if (data.Items.length === 0) {
      return { error: "Item not found", status: 404 };
    } else {
      const item = data.Items[0]; // 이거 기리형이 한것처럼 assaing 으로 item 객체에 필요한 정보 추가하는식으로 하자
      response = {
        user_id: item.user_id,
        owner: item.user_id, // owner 는 user_id 와 같음.
        item_id: item.item_id,
        img: item.img,
        taken_id: item.taken_id,
        createdAt: item.createdAt,
        expiredAt: item.expiredAt,
        share: item.share,
        rental: item.rental,
        isExist: item.isExist,
      };
      // res.send(response);
      return response;
    }
  } catch (error) {
    console.error("Error retrieving item:", JSON.stringify(error, null, 2));
    // res.status(500).send({ error: "Internal server error" });
    response = { error: "Internal server error", status: 500 };
    return response;
  }
}

app.get("/storage/me", async function (req, res) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const userId = jwt.verify(token, "1234", (err, user) => {
    console.log(user.id);
    return user.id; // Assume that user object has a field called 'id'
  });
  let result;
  const params = {
    TableName: "storage",
    KeyConditionExpression: "user_id = :user_id",
    ExpressionAttributeValues: {
      ":user_id": userId,
    },
  };
  try {
    const data = await dynamo.query(params).promise();
    console.log("Items:", data.Items);
    result = data.Items;
  } catch (error) {
    console.error("Error retrieving items:", JSON.stringify(error, null, 2));
    result = { error };
  }
  res.send(result);
});

// status update
app.post("/storage", upload.single("img"), async function (req, res) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const userId = jwt.verify(token, "1234", (err, user) => {
    console.log(user.id);
    return user.id; // Assume that user object has a field called 'id'
  });
  const preparams = {
    TableName: "user",
    Key: {
      user_id: userId,
    },
  };
  const predata = await dynamo.get(preparams).promise();
  console.log("predata : ", predata);

  const img = await sharp(req.file.buffer)
    .resize({
      height: 100,
      width: 100,
      fit: "cover",
    })
    .toBuffer();
  const imgKey = await uploadImage(img);
  const time_now = new Date().getTime();
  const time_expired =
    time_now + 1000 * 60 * 60 * 24 * Number(req.body.expiryDate);
  itemId_cnt = req.body.item_id + "_" + predata.Item.item_cnt;
  console.log("item_id: ", itemId_cnt);
  try {
    const params = {
      TransactItems: [
        {
          Put: {
            TableName: "storage",
            Item: Object.assign({}, req.body, {
              user_id: userId,
              item_id: itemId_cnt,
              createdAt: time_now,
              expiredAt: time_expired,
              img: `https://img.42greenbox.com/${imgKey}`,
              isExist: "true",
              taken_id: "None",
              // share: "false", front 가 줌 .
              // rental: "false",
            }),
          },
        },
        {
          Update: {
            TableName: "user",
            Key: {
              user_id: userId,
            },
            UpdateExpression:
              "SET item_cnt = item_cnt + :val, point = point + :point",
            ExpressionAttributeValues: {
              ":val": 1, // item_cnt 업데이트
              ":point": -100, // point 업데이트
            },
          },
        },
        {
          Put: {
            TableName: "ledger",
            Item: {
              // assaing() 으로 하자
              user_id: userId,
              taken_id: "None",
              created_at: new Date().getTime(),
              item_id: itemId_cnt,
              point: -100,
              location: req.body.location,
              status: "takeIn",
            },
          },
        },
      ],
    };

    const data = await dynamo.transactWrite(params).promise();
    console.log("Transaction successful:", data);
    res.send({ success: true });
  } catch (error) {
    console.error("Error updating data:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

app.put("/storage", async function (req, res) {
  // itemid, userid 없는 경우 에러처리
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const userId = jwt.verify(token, "1234", (err, user) => {
    // console.log(user.id);
    return user.id; // Assume that user object has a field called 'id'
  });
  console.log("req.body : ", req.body);
  const preparams = {
    TableName: "storage",
    Key: {
      user_id: req.body.user_id,
      item_id: req.body.item_id,
    },
  };

  try {
    const predata = await dynamo.get(preparams).promise();
    console.log("predata : ", predata);
    let point = 0;
    // 여기서

    if (predata.Item.isExist === "false") {
      res.status(400).send({ error: "Item is already taken" });
    }
    switch (req.body.status) {
      case "takeShared":
        if (predata.Item.share === "false") {
          res.status(400).send({ error: "Item is not shared" });
        }
        point = 0;
        break;
      case "takeMine":
        if (predata.Item.expiredAt < new Date().getTime()) {
          point = 0;
        } else {
          point = 80;
        }
        break;
      case "takeOthers": // 남에꺼 뺄때는 기간 지난것만 뺄수있게 해야한다.
        // 기간 안지난 거면 share 이 true 인것만 뺄수 있음 그러면 여기로 오면 안 된다.
        if (predata.Item.expiredAt < new Date().getTime()) {
          point = 100;
        } else {
          res.status(400).send({ error: "Item is not expired" });
        }
        break;
      default:
        // 기본 동작 (status message 없는 경우)
        break;
    }
    console.log("POINT: ", point);
    const params = {
      TransactItems: [
        {
          Update: {
            TableName: "storage",
            Key: {
              user_id: predata.Item.user_id,
              item_id: req.body.item_id,
            },
            UpdateExpression: "SET isExist = :val, taken_id = :taken_id", // is_exist 필드를 업데이트
            ExpressionAttributeValues: {
              ":val": "false", // is_exist 값을 false로 설정
              ":taken_id": userId,
            },
          },
        },
        {
          Update: {
            TableName: "user",
            Key: {
              user_id: userId,
            },
            UpdateExpression: "SET point = point + :val",
            ExpressionAttributeValues: {
              ":val": Number(point), // 80 인지, 0 인지, 100 인지 status에 따라 달라짐.
            },
          },
        },
        {
          Put: {
            TableName: "ledger",
            Item: {
              user_id: userId,
              item_user_id: predata.Item.user_id,
              created_at: new Date().getTime(),
              item_id: req.body.item_id,
              location: predata.Item.location,
              point: Number(point),
              taken_id: predata.Item.taken_id,
              status: req.body.status,
            },
          },
        },
      ],
    };

    const data = await dynamo.transactWrite(params).promise();
    console.log("Transaction successful:", data);
    res.send({ success: true });
  } catch (error) {
    console.error("Error updating data:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

app.get("/ledger/me", async function (req, res) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const userId = jwt.verify(token, "1234", (err, user) => {
    console.log(user.id);
    return user.id; // Assume that user object has a field called 'id'
  });

  const params = {
    TableName: "ledger",
    KeyConditionExpression: "user_id = :user_id",
    ExpressionAttributeValues: {
      ":user_id": userId,
    },
  };

  try {
    const data = await dynamo.query(params).promise();
    console.log(data);
    if (!data || data.Items.length === 0) {
      // 사용자의 포인트 정보가 없을 경우 빈 배열 반환
      res.send([]);
    } else {
      // 사용자의 포인트 정보 로그들을 전부 반환
      const logs = data.Items;
      res.send({ Logs: logs });
    }
  } catch (error) {
    console.error(
      "Error retrieving point information:",
      JSON.stringify(error, null, 2)
    );
    res.status(500).send({ error: "Internal server error" });
  }
});

app.get("/divide/share", async function (req, res) {
  console.log("fuck i can't invoked");
  try {
    // DynamoDB에서 데이터를 가져오는 코드
    const params = {
      TableName: "storage",
      FilterExpression: "#share = :shareValue and #isExist = :isExistValue", // 필터 표현식 추가
      ExpressionAttributeNames: {
        "#share": "share", // 필터 표현식에서 사용할 속성 이름
        "#isExist": "isExist", // 필터 표현식에서 사용할 속성 이름
      },
      ExpressionAttributeValues: {
        ":shareValue": "true", // "share" 속성과 비교할 값
        ":isExistValue": "true", // "isExist" 속성과 비교할 값
      },
    };

    const data = await dynamo.scan(params).promise(); // 스캔 또는 쿼리를 사용해 데이터를 가져옵니다.

    // "share: true" 데이터를 클라이언트에게 응답으로 보냅니다.
    const shareData = data.Items; // 이미 필터링된 데이터를 사용할 수 있습니다.
    res.json(shareData);
  } catch (error) {
    console.error("Error retrieving share data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/divide/expire", async function (req, res) {
  try {
    // 현재 시간을 가져오는 코드
    const currentTime = new Date().getTime();

    // DynamoDB에서 데이터를 가져오는 코드
    const params = {
      TableName: "storage",
      FilterExpression:
        "#expiredAt < :currentTime and #isExist = :isExistValue", // 필터 표현식 추가
      ExpressionAttributeNames: {
        "#expiredAt": "expiredAt", // 필터 표현식에서 사용할 속성 이름
        "#isExist": "isExist", // 필터 표현식에서 사용할 속성 이름
      },
      ExpressionAttributeValues: {
        ":currentTime": Number(currentTime), // "expireAt"과 비교할 현재 시간
        ":isExistValue": "true", // "isExist" 속성과 비교할 값
      },
    };

    const data = await dynamo.scan(params).promise(); // 스캔 또는 쿼리를 사용해 데이터를 가져옵니다.
    // "expireAt"이 현재 시간보다 작은 데이터를 클라이언트에게 응답으로 보냅니다.
    res.json(data.Items);
  } catch (error) {
    console.error("Error retrieving expired data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/register", async function (req, res) {
  console.log(req.headers["authorization"]);
  console.log(req.body);
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const userId = jwt.verify(token, "1234", (err, user) => {
    console.log(user.id);
    return user.id; // Assume that user object has a field called 'id'
  });
  const params = {
    TableName: "user",
    KeyConditionExpression: "user_id = :user_id",
    ExpressionAttributeValues: {
      ":user_id": userId,
    },
  };

  try {
    const data = await dynamo.query(params).promise();
    console.log("Items:", data.Items);
    result = data.Items[0];
    const put_params = {
      TableName: "user",
      Item: Object.assign({}, result, {
        push: req.body.body,
      }),
    };
    await dynamo.put(put_params).promise();
  } catch (error) {
    console.error("Error retrieving items:", JSON.stringify(error, null, 2));
    result = { error };
  }
  webpush.setVapidDetails(
    "https://server.42greenbox.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  webpush.sendNotification(
    JSON.parse(req.body.body),
    JSON.stringify({
      title: `$Welcome ${userId}!`,
      body: `test push`,
    })
  );
  res.send({ success: true });
});

module.exports.handler = serverless(app);
