"use strict";
const aws = require("aws-sdk");
const webpush = require('web-push');

const dynamo = new aws.DynamoDB.DocumentClient();
module.exports.handler = async (event) => {
    //   console.log("fuck!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    const result = await getExpiredItem();
    console.log(result);
};
// ToDo: 하루전, 3시간전에 이 목록 업데이트 하기.  // 함수 하나 더 만들어서 ? 
async function getExpiredItem() {
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
        }
        const data = await dynamo.scan(params).promise(); // 스캔 또는 쿼리를 사용해 데이터를 가져옵니다.
        const items = data.Items;

        // 웹 푸시 알람을 보내는 코드
        for (const item of items) {
            const pushSubscription = JSON.parse(await getUserToken(item.userId)); // DynamoDB에서 가져온 데이터에서 pushSubscription을 파싱합니다.
            webpush.setVapidDetails(
                "https://server.42greenbox.com",
                process.env.VAPID_PUBLIC_KEY,
                process.env.VAPID_PRIVATE_KEY
            );
            webpush.sendNotification(
                pushSubscription,
                JSON.stringify({
                    title: `${item.userId} ITEM OUT OF DATE!`,
                    body: `plz check your item!`,
                })
            );
        }
        return items;
    } catch (error) {
        console.log("Error retrieving expired data:", error);
        return { error: "Error" };
    }
}

async function getUserToken(userId) {
    try {
        const params = {
            TableName: "user",
            Key: {
                userId: userId,
            },
        };
        const data = await dynamo.get(params).promise();
        return data.Item.push;
    } catch (error) {
        console.log("Error retrieving user token:", error);
        return { error: "Error" };
    }
}