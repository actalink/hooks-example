import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { NextPage } from "next";
import {
  useActaAccount,
  useFees,
  useMerkleSignUserOps,
  useSalt,
  useSIWE,
  useCancel,
  useListUserOperations,
  type BodyType,
} from "@actalink/react-hooks";
import { useAccount } from "wagmi";
import { Address, getAddress, parseUnits, encodePacked } from "viem";
import { UserOperation } from "viem/account-abstraction";
import { createTransferCallData } from "@actalink/modules";
import { toSignedPaymasterData } from "@actalink/sdk";
import { config } from "../wagmi";
import { useEffect, useState } from "react";
import { additionalValidatorAddresses, defaultValidatorAddresses, erc20PaymasterUrls, erc20PaymasterAddresses, usdcAddresses } from "../constants";

function getDefaultUserOp(): UserOperation<"0.7"> {
  return {
    sender: "0x0000000000000000000000000000000000000000",
    nonce: 0n,
    callGasLimit: 2n * 10n ** 6n,
    callData: "0x",
    maxPriorityFeePerGas: 2n * 10n ** 6n,
    maxFeePerGas: 2n * 10n ** 6n,
    preVerificationGas: 2n * 10n ** 6n,
    signature: "0x",
    verificationGasLimit: 2n * 10n ** 6n,
  };
}

const Home: NextPage = () => {
  const { address, status, chainId } = useAccount();
  const defaultValidator = defaultValidatorAddresses[chainId ?? 137];
  const addValidators = additionalValidatorAddresses[chainId ?? 137].split(',').map((v) => getAddress(v.trim()));
  const paymasterUrl = erc20PaymasterUrls[chainId ?? 137];
  const paymasterAddress = erc20PaymasterAddresses[chainId ?? 137];
  const usdcAddress = usdcAddresses[chainId ?? 137];

  const validators = [defaultValidator, ...addValidators];

 
  const { address: swAddress, actaAccount, error } = useActaAccount({
    eoaAddress: address,
    eoaStatus: status,
    chainId,
    config,
    validators
  });
  console.log(`swError: ${error}`)
  console.log(`swAddress: ${swAddress}`);
  const { calculateActaFees, getActaFeesRecipients,getPaymasterfees } = useFees({ config });
  const { createERC20Transfer } = useMerkleSignUserOps({
    eoaAddress: address,
    config,
  });
  const { fetchSIWEToken } = useSIWE({
    eoaAddress: address,
    eoaStatus: status,
    chainId: chainId,
    config,
  });
  const { salt } = useSalt({ eoaAddress: address, eoaStatus: status, config });

  const { cancel } = useCancel();
  const { list } = useListUserOperations();

  const [receiver, setReceiver] = useState<string>("0x");

  const [frequency, setFrequency] = useState<string>("minutes");
  const [volume, setVolume] = useState<number>(0);
  const [amount, setAmount] = useState<string>("0");
  const [isDeployed, setIsDeployed] = useState<boolean>(false)
  const generateExecutionTimes = (
    startInMs: number,
    freq: string,
    times: number
  ) => {
    const execTimes: Array<number> = [];
    execTimes.push(startInMs);

    if (times === 1) {
      return execTimes;
    }

    for (let i = 1; i < times; i++) {
      let nextDateInMs: number;

      switch (freq) {
        case "minutes":
          nextDateInMs = startInMs + i * 5 * 60 * 1000;
          break;

        case "daily":
          nextDateInMs = startInMs + i * 24 * 60 * 60 * 1000;
          break;

        case "weekly":
          nextDateInMs = startInMs + i * 7 * 24 * 60 * 60 * 1000;
          break;

        case "monthly": {
          const startMonthDate = new Date(startInMs);
          startMonthDate.setMonth(startMonthDate.getMonth() + i);
          nextDateInMs = startMonthDate.getTime();
          break;
        }

        case "quarterly": {
          const startQuarterDate = new Date(startInMs);
          startQuarterDate.setMonth(startQuarterDate.getMonth() + i * 3);
          nextDateInMs = startQuarterDate.getTime();
          break;
        }

        case "halfyearly": {
          const startHalfYearDate = new Date(startInMs);
          startHalfYearDate.setMonth(startHalfYearDate.getMonth() + i * 6);
          nextDateInMs = startHalfYearDate.getTime();
          break;
        }

        case "yearly": {
          const startYearDate = new Date(startInMs);
          startYearDate.setFullYear(startYearDate.getFullYear() + i);
          nextDateInMs = startYearDate.getTime();
          break;
        }

        default:
          throw new Error(`Invalid frequency: ${freq}`);
      }

      execTimes.push(nextDateInMs);
    }

    return execTimes;
  };

  const createERC20RecurringPayment = async (
    recipientAddr: Address,
    executionTimes: Array<number>,
    amount: bigint,
    times: number
  ) => {
    try {
      if (actaAccount === undefined) {
        return;
      }
      const actaFees = await calculateActaFees(amount, validators[0]);
      const paymasterFees = await getPaymasterfees(validators[0]);
      const {actaFeesRecipient, paymasterFeesRecipient} = await getActaFeesRecipients(validators[0]);
      console.log(`amount: ${amount}`);
      console.log(`actafees: ${actaFees}`);
      const userOps: Array<UserOperation<"0.7">> = [];
      const { factory, factoryData } = await actaAccount.getFactoryArgs();
      console.log(`factory: ${factory}`);
      console.log(`factoryData: ${factoryData}`);
      const nonce = await actaAccount.getValidatorNonce();
      console.log(`nonce: ${nonce}`);
      if (swAddress && actaFees !== undefined && nonce) {
        const transferData = await createTransferCallData(
          address as Address,
          recipientAddr,
          usdcAddress as Address,
          amount,
          actaFees,
          paymasterFees,
          actaFeesRecipient, 
          paymasterFeesRecipient
        );
        for (let i = 0; i < times; i++) {
          const preOp: UserOperation<"0.7"> = {
            ...getDefaultUserOp(),
            sender: swAddress as Address,
            nonce: nonce + BigInt(i),
            callData: transferData,
            paymaster: paymasterAddress,
            paymasterData: encodePacked(['address', 'uint128', 'uint128'], [paymasterAddress, 100000n, 500000n]),
          };
          const sponsoredUserOp = await toSignedPaymasterData(
            `${paymasterUrl}/api/sign/v2`,
            preOp
          );
          const userOp: UserOperation<"0.7"> = {
            ...sponsoredUserOp,
            paymaster: paymasterAddress,
          };
          userOps.push(userOp);
        }
      }
      // Merkle signature stuff
      await createERC20Transfer({
        userOps: userOps,
        executionTimes: executionTimes,
        paymasterUrl: paymasterUrl,
        paymentType: "transfers",
      });
    } catch (error) {
      console.error("Error in createERC20RecurringPayment: ", error);
    }
  };

  const signActaMessage = async () => {
    if (actaAccount === undefined) {
      console.log(`not available sw`);
      return;
    }
     console.log(`status: ${ await actaAccount?.isDeployed()}`)
    // const result = await actaAccount.signMessage({ message: "Hello world" });
    // console.log(`signedMessage: ${result}`);
  };

  const createTransaction = async () => {
    const execTimes = generateExecutionTimes(
      Date.now() + 3 * 60 * 1000,
      frequency,
      volume
    );
    if (amount === "0" || receiver === "0x" || volume === 0) {
      console.log("please fill all fields");
      return;
    }
    const usdcAmount = parseUnits(amount, 6);
    await createERC20RecurringPayment(
      receiver as Address,
      execTimes,
      usdcAmount,
      volume
    );
  };

  const cancelPendingTransactions = async () => {
    const token = await fetchSIWEToken(paymasterUrl);
    if (token) {
      if (salt) {
        const body = {
          validators: [defaultValidator, ...addValidators],
          salt,
        };
        cancel(token.token as string, body as BodyType, paymasterUrl);
      }
    }
  };

  const checkIsDeployed = async () => {
    const status = await actaAccount?.isDeployed();
    if(status !== undefined){
      setIsDeployed(status)
    }
    return status;
  }

  const deployAccount = async () => {
    if(actaAccount !== undefined){
      const hash = await actaAccount.deployAccount();
      console.log(`account deployed: ${hash}`)
    }
  }

  const listScheduledTransfers = async () => {
    // TODO: implement list operations
    // Check why a different salt for smart wallet would not be able to fetch the scheduled operations from paymaster
    // get authtoken from SIWE auth
    const token = await fetchSIWEToken(paymasterUrl);
    if (token) {
      if (salt) {
        const body = {
          validators: [defaultValidator, ...addValidators],
          salt,
        };
        const useOpsList = await list(token.token as string, body as BodyType, paymasterUrl);
        console.log(useOpsList);
      }
    }

  };

  useEffect(() => {
    if(swAddress !== undefined){
      checkIsDeployed();
    }
  },[swAddress])
  return (
    <main className="w-full flex flex-col justify-center items-center">
      <div className="flex w-full justify-between items-center my-4 px-4">
        <h1 className="text-2xl font-bold">Exmaple app</h1>
        <ConnectButton />
      </div>
      <div className="flex flex-col w-auto px-4 py-5 justify-center items-center gap-2 bg-slate-300 rounded-md">
        <div className="flex flex-col w-full justify-center items-start gap-2">
          <label htmlFor="address">
            <span className="font-bold">Address</span>
          </label>
          <input
            type="text"
            id="address"
            placeholder="0x1234"
            className="w-96 h-8 px-2 rounded-md"
            onChange={(e) => {
              setReceiver(e.target.value);
            }}
          />
        </div>
        <div className="flex flex-col w-full justify-center items-start gap-2">
          <label htmlFor="address">
            <span className="font-bold">Volume</span>
          </label>
          <input
            type="text"
            id="volume"
            placeholder="3"
            className="w-96 h-8 px-2 rounded-md"
            onChange={(e) => {
              setVolume(parseInt(e.target.value));
            }}
          />
        </div>
        <div className="flex flex-col w-full justify-center items-start gap-2">
          <label htmlFor="frequency">
            <span className="font-bold">Frequency</span>
          </label>
          <select
            name="frequency"
            id="frequency"
            className="w-96 h-8 px-2 rounded-md"
            onChange={(e) => {
              setFrequency(e.target.value);
            }}
          >
            <option value="minutes">5mins</option>
          </select>
        </div>
        <div className="flex flex-col w-full justify-center items-start gap-2">
          <label htmlFor="address">
            <span className="font-bold">Amount</span>
          </label>
          <input
            type="text"
            id="volume"
            placeholder="3"
            className="w-96 h-8 px-2 rounded-md"
            onChange={(e) => {
              setAmount(e.target.value);
            }}
          />
        </div>
        {/* If status is connected render buttons */}
        {status === "connected" && (
          <>
            <button
              className="px-2 py-2 bg-green-400 rounded-md text-white font-bold"
              disabled={isDeployed}
              onClick={(e) => {
                deployAccount();
              }}
            >
              Deploy
            </button>
            <button
              className="px-2 py-2 bg-blue-400 rounded-md text-white font-bold"
              onClick={(e) => {
                createTransaction();
              }}
            >
              submit
            </button>
            <button
              className="px-2 py-2 bg-blue-400 rounded-md text-white font-bold"
              onClick={(e) => {
                listScheduledTransfers();
              }}
            >
              List scheduled
            </button>
            <button
              className="px-2 py-2 bg-red-400 rounded-md text-white font-bold"
              onClick={(e) => {
                cancelPendingTransactions();
              }}
            >
              Cancel Pending
            </button>
          </>
        )}
      </div>
    </main>
  );
};

export default Home;
