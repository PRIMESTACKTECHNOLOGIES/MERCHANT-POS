import axios from "axios";

async function getWiseProfileId() {
  const res = await axios.get("https://api.wise.com/v1/profiles", {
    headers: {
      Authorization: `Bearer ${process.env.WISE_TOKEN}`
    }
  });

  console.log(res.data);
}

getWiseProfileId();
