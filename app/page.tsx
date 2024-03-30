import Image from "next/image";
import Card from "../components/Card";

import Fonts from "@/src/components/Fonts";

export default function Home() {
  return (
    <main className="flex flex-col justify-evenly h-screen text-white items-center ">
      <div className=" w-full bg-black  h-screen flex flex-col items-center justify-center overflow-hidden rounded-md">
        <Fonts />
      </div>
        
    </main>
  );
}
