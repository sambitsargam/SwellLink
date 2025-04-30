import express from 'express';
import bodyParser from 'body-parser';
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { http } from "viem";
import { createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import twilio from "twilio";
import { getOnChainTools } from "@goat-sdk/adapter-vercel-ai";
import { viem } from "@goat-sdk/wallet-viem";

require("dotenv").config();
const app = express();
app.use(bodyParser.json());

const swellchainTestnet = {
  id: 1924,
  name: 'Swellchain Testnet',
  network: 'swell-testnet',
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://swell-testnet.alt.technology'],
    },
    public: {
      http: ['https://swell-testnet.alt.technology'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Swell Testnet Explorer',
      url: 'https://swell-testnet-explorer.alt.technology',
    },
  },
};

const account = privateKeyToAccount(process.env.KEY as `0x${string}`);
const walletClient = createWalletClient({
  account: account,
  transport: http(process.env.RPC_PROVIDER_URL),
  chain: swellchainTestnet,
});
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const strategyManagerAbi = [
  {
    "inputs": [],
    "name": "getCurrentStrategy",
    "outputs": [
      { "name": "name", "type": "string" },
      { "name": "multiplier", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const delegationManagerAbi = [
  {
    "inputs": [{ "name": "delegator", "type": "address" }],
    "name": "getDelegation",
    "outputs": [
      { "name": "amount", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "amount", "type": "uint256" }],
    "name": "delegate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "name": "amount", "type": "uint256" }],
    "name": "unstake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const rewardsCoordinatorAbi = [
  {
    "inputs": [{ "name": "staker", "type": "address" }],
    "name": "getRewards",
    "outputs": [
      { "name": "rewards", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const { createPublicClient } = await import('viem');
const publicClient = createPublicClient({
  chain: swellchainTestnet,
  transport: http("https://swell-testnet.alt.technology")
});

app.post("/api/send-whatsapp", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body?.toLowerCase();
  const userAddress = process.env.USER_ADDRESS;

  try {
    let response = "";

    if (body.includes("strategy")) {
      const contract = {
        address: "0xe62f209e25d49c99b451975ccd43a7bdf8aed8dc",
        abi: strategyManagerAbi,
      };
      const [name, multiplier] = await publicClient.readContract({
        ...contract,
        functionName: "getCurrentStrategy",
      });
      response = `Current strategy: ${name}, Yield Multiplier: ${Number(multiplier) / 100}x`;

    } else if (body.includes("my stake")) {
      const contract = {
        address: "0x94039ce3c372efef4e6d7bb95c8a06bdc9bce19a",
        abi: delegationManagerAbi,
      };
      const amount = await publicClient.readContract({
        ...contract,
        functionName: "getDelegation",
        args: [userAddress],
      });
      response = `You have staked: ${Number(amount) / 1e18} ETH.`;

    } else if (body.includes("rewards")) {
      const contract = {
        address: "0xc9dbd75fa3a89ecff9e4295be582ffa205847e42",
        abi: rewardsCoordinatorAbi,
      };
      const rewards = await publicClient.readContract({
        ...contract,
        functionName: "getRewards",
        args: [userAddress],
      });
      response = `Your current pending rewards: ${Number(rewards) / 1e18} ETH.`;

    } else if (body.includes("delegate")) {
      const contract = {
        address: "0x94039ce3c372efef4e6d7bb95c8a06bdc9bce19a",
        abi: delegationManagerAbi,
      };
      await walletClient.writeContract({
        ...contract,
        functionName: "delegate",
        args: [BigInt(1e18)] // 1 ETH example
      });
      response = `Successfully delegated 1 ETH.`;

    } else if (body.includes("unstake")) {
      const contract = {
        address: "0x94039ce3c372efef4e6d7bb95c8a06bdc9bce19a",
        abi: delegationManagerAbi,
      };
      await walletClient.writeContract({
        ...contract,
        functionName: "unstake",
        args: [BigInt(1e18)]
      });
      response = `Successfully unstaked 1 ETH.`;

    } else {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: body,
        maxSteps: 8
      });
      response = result.text;
    }

    const message = await twilioClient.messages.create({
      to: from,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      body: response,
    });

    res.json({ success: true, message: "Reply sent.", sid: message.sid });
  } catch (error) {
    console.error("Error:", error);
    await twilioClient.messages.create({
      to: from,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      body: "Sorry, something went wrong. Please try again later."
    });
    res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
